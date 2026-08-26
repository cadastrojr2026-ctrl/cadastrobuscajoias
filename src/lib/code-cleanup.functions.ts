import { createServerFn } from "@tanstack/react-start";
import { requireApprovedUser } from "@/integrations/supabase/require-approved";
import { z } from "zod";

/**
 * Remove do código apenas o peso/valor numérico (com ou sem parênteses) e o
 * separador que o antecede. Sufixos com significado — (2), (6MM), (ADEMAR) —
 * são preservados.
 */
const WEIGHT_RE = /[ _]*-[ _]*\(?\d+(?:[.,]\d+)?\)?/g;

export function cleanCode(code: string): string {
  return code
    .replace(WEIGHT_RE, "")
    .replace(/^[ _-]+|[ _-]+$/g, "")
    .trim()
    .toUpperCase();
}

type Row = {
  id: string;
  code: string;
  image_path: string;
  product_code: string | null;
};

async function assertAdmin(context: { supabase: any; userId: string }) {
  const { data: role } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  if (!role) throw new Error("Apenas administradores.");
}

async function fetchAll(supabase: any): Promise<Row[]> {
  const all: Row[] = [];
  const page = 1000;
  for (let from = 0; ; from += page) {
    const { data, error } = await supabase
      .from("pieces")
      .select("id, code, image_path, product_code")
      .order("code", { ascending: true })
      .range(from, from + page - 1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as Row[];
    all.push(...rows);
    if (rows.length < page) break;
  }
  return all;
}

function plan(rows: Row[]) {
  const existing = new Set(rows.map((r) => r.code.toUpperCase()));
  const affected = rows
    .map((r) => ({ row: r, target: cleanCode(r.code) }))
    .filter((x) => x.target.length > 0 && x.target !== r_code(x.row));
  return { existing, affected };
}

function r_code(r: Row) {
  return r.code.toUpperCase();
}

export const previewCodeCleanup = createServerFn({ method: "GET" })
  .middleware([requireApprovedUser])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const rows = await fetchAll(context.supabase);
    const { existing, affected } = plan(rows);
    const conflicts = affected.filter((a) => existing.has(a.target)).length;
    return {
      total: rows.length,
      affected: affected.length,
      conflicts,
      sample: affected.slice(0, 15).map((a) => ({ from: a.row.code, to: a.target })),
    };
  });

/**
 * Aplica a limpeza em blocos. Erros individuais são registrados e não
 * interrompem o restante do lote. Embeddings são preservados.
 */
export const applyCodeCleanup = createServerFn({ method: "POST" })
  .middleware([requireApprovedUser])
  .inputValidator((i: unknown) =>
    z
      .object({ limit: z.number().min(1).max(300).default(150) })
      .partial({ limit: true })
      .parse(i ?? {}),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const limit = data.limit ?? 150;
    const rows = await fetchAll(context.supabase);
    const { existing, affected } = plan(rows);

    const batch = affected.slice(0, limit);
    const errors: Array<{ code: string; message: string }> = [];
    let renamed = 0;
    let conflictsResolved = 0;

    for (const item of batch) {
      const piece = item.row;
      try {
        // Resolve conflito: mantém como foto adicional do mesmo produto.
        let finalCode = item.target;
        if (existing.has(finalCode)) {
          let n = 2;
          while (existing.has(`${item.target}_(${n})`)) n++;
          finalCode = `${item.target}_(${n})`;
          conflictsResolved++;
        }

        const ext = piece.image_path.split(".").pop()?.toLowerCase() ?? "jpg";
        const targetPath = `${finalCode}.${ext}`;
        let imagePath = piece.image_path;
        if (targetPath !== piece.image_path) {
          const { error: mvErr } = await context.supabase.storage
            .from("pieces")
            .move(piece.image_path, targetPath);
          if (mvErr) throw new Error(`armazenamento: ${mvErr.message}`);
          imagePath = targetPath;
        }

        const { error: upErr } = await context.supabase
          .from("pieces")
          .update({ code: finalCode, product_code: item.target, image_path: imagePath })
          .eq("id", piece.id);
        if (upErr) {
          // desfaz o move para manter consistência
          if (imagePath !== piece.image_path) {
            await context.supabase.storage.from("pieces").move(imagePath, piece.image_path);
          }
          throw new Error(upErr.message);
        }

        existing.delete(r_code(piece));
        existing.add(finalCode);
        renamed++;
      } catch (e) {
        errors.push({ code: piece.code, message: e instanceof Error ? e.message : "erro" });
      }
    }

    return {
      processed: batch.length,
      renamed,
      conflictsResolved,
      failed: errors.length,
      errors,
      remaining: Math.max(0, affected.length - batch.length),
      status: errors.length === 0 ? ("ok" as const) : ("partial" as const),
    };
  });

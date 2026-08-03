import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

type SyncError = { code: string; message: string };

async function assertAdmin(context: { supabase: any; userId: string }) {
  const { data: role } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  if (!role) throw new Error("Apenas administradores.");
}

/** Integridade do índice: peças sem embedding (fora da busca por imagem). */
export const getIndexHealth = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);

    const total = await context.supabase
      .from("pieces")
      .select("id", { count: "exact", head: true });
    const missing = await context.supabase
      .from("pieces")
      .select("id", { count: "exact", head: true })
      .is("embedding", null);
    const products = await context.supabase
      .from("pieces")
      .select("id", { count: "exact", head: true })
      .not("product_code", "is", null);

    if (total.error) throw new Error(total.error.message);
    if (missing.error) throw new Error(missing.error.message);

    const totalCount = total.count ?? 0;
    const missingCount = missing.count ?? 0;
    return {
      total: totalCount,
      indexed: totalCount - missingCount,
      missing: missingCount,
      withProductCode: products.count ?? 0,
      healthy: missingCount === 0,
    };
  });

/**
 * Atualização INCREMENTAL do índice vetorial.
 * Processa apenas peças sem embedding (novas ou com falha anterior) ou os
 * códigos informados (imagens substituídas). Erros por peça são registrados
 * e não interrompem as demais.
 */
export const syncIndexIncremental = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        codes: z.array(z.string().min(1).max(50)).max(200).optional(),
        limit: z.number().min(1).max(60).default(25),
      })
      .partial({ limit: true })
      .parse(i ?? {}),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { embedImage, SHAPE_HINT } = await import("./embed.server");
    const limit = data.limit ?? 25;

    let query = context.supabase
      .from("pieces")
      .select("id, code, category, image_path")
      .limit(limit);
    if (data.codes && data.codes.length > 0) {
      query = query.in("code", data.codes.map((c) => c.trim().toUpperCase()));
    } else {
      query = query.is("embedding", null);
    }

    const { data: rows, error } = await query;
    if (error) throw new Error(error.message);

    const errors: SyncError[] = [];
    const updated: string[] = [];

    for (const row of rows ?? []) {
      try {
        const dl = await context.supabase.storage.from("pieces").download(row.image_path);
        if (dl.error || !dl.data) throw new Error(dl.error?.message ?? "imagem não encontrada no storage");
        const buf = new Uint8Array(await dl.data.arrayBuffer());
        let bin = "";
        for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
        const ext = row.image_path.split(".").pop()?.toLowerCase();
        const mime = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
        const dataUrl = `data:${mime};base64,${btoa(bin)}`;

        const emb = await embedImage(dataUrl, `${SHAPE_HINT} Catalog item code ${row.code}.`);
        const { error: upErr } = await context.supabase
          .from("pieces")
          .update({ embedding: emb as unknown as string })
          .eq("id", row.id);
        if (upErr) throw new Error(upErr.message);
        updated.push(row.code);
      } catch (e) {
        errors.push({ code: row.code, message: e instanceof Error ? e.message : "erro" });
      }
    }

    // Verificação de integridade pós-sincronização
    const stillMissing = await context.supabase
      .from("pieces")
      .select("id", { count: "exact", head: true })
      .is("embedding", null);

    return {
      processed: (rows ?? []).length,
      embeddingsUpdated: updated.length,
      updatedCodes: updated,
      failed: errors.length,
      errors,
      remainingWithoutEmbedding: stillMissing.count ?? 0,
      status: errors.length === 0 ? ("ok" as const) : ("partial" as const),
    };
  });

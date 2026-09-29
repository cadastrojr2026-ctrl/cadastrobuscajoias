import { createServerFn } from "@tanstack/react-start";
import { requireApprovedUser } from "@/integrations/supabase/require-approved";
import { z } from "zod";

export const searchByText = createServerFn({ method: "POST" })
  .middleware([requireApprovedUser])
  .inputValidator((i: unknown) =>
    z
      .object({
        q: z.string().min(1).max(100),
        limit: z.number().min(1).max(60).default(30),
        category: z.string().optional(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const q = data.q.trim();
    let query = context.supabase
      .from("pieces")
      .select("id, code, name, image_path, category")
      .or(`code.ilike.%${q}%,name.ilike.%${q}%`)
      .limit(data.limit);
    if (data.category) query = query.eq("category", data.category);
    const { data: rows, error } = await query;
    if (error) throw new Error(error.message);
    return rows ?? [];
  });


export const getMyRole = createServerFn({ method: "GET" })
  .middleware([requireApprovedUser])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    const roles = (data ?? []).map((r) => r.role);
    return { roles, isAdmin: roles.includes("admin") };
  });

export const listAllPieces = createServerFn({ method: "GET" })
  .middleware([requireApprovedUser])
  .inputValidator((i: unknown) => z.object({ category: z.string().optional() }).optional().parse(i))
  .handler(async ({ data, context }) => {
    let query = context.supabase
      .from("pieces")
      .select("id, code, name, image_path, category, created_at")
      .order("code", { ascending: true });
    if (data?.category) query = query.eq("category", data.category);
    const { data: rows, error } = await query;
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const countPieces = createServerFn({ method: "GET" })
  .middleware([requireApprovedUser])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase.from("pieces").select("category");
    if (error) throw new Error(error.message);
    const total = data?.length ?? 0;
    const byCategory: Record<string, number> = {};
    for (const r of data ?? []) {
      const k = r.category ?? "outros";
      byCategory[k] = (byCategory[k] ?? 0) + 1;
    }
    return { total, byCategory };
  });


export const addPiece = createServerFn({ method: "POST" })
  .middleware([requireApprovedUser])
  .inputValidator((i: unknown) =>
    z
      .object({
        code: z.string().min(1).max(50),
        // produto ao qual esta foto pertence (permite várias fotos por produto)
        productCode: z.string().min(1).max(50).optional(),
        name: z.string().max(120).optional(),
        category: z.string().max(40).optional(),
        imageDataUrl: z.string().min(20),
        // vetor visual calculado no navegador (índice v2, gratuito)
        embeddingV2: z.array(z.number()).length(384),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    // Verify admin
    const { data: role } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!role) throw new Error("Apenas administradores podem cadastrar peças.");

    const code = data.code.trim().toUpperCase();
    const productCode = (data.productCode ?? code).trim().toUpperCase();
    const match = data.imageDataUrl.match(/^data:(image\/[a-z]+);base64,(.+)$/);
    if (!match) throw new Error("Formato de imagem inválido.");
    const mime = match[1];
    const ext = mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg";
    const bytes = Uint8Array.from(atob(match[2]), (c) => c.charCodeAt(0));

    // Atualização incremental: descobre se a peça já existe (substituição)
    const { data: existing } = await context.supabase
      .from("pieces")
      .select("id, image_path")
      .eq("code", code)
      .maybeSingle();

    const path = `${code}.${ext}`;
    const { error: upErr } = await context.supabase.storage
      .from("pieces")
      .upload(path, bytes, { contentType: mime, upsert: true });
    if (upErr) throw new Error(`Upload: ${upErr.message}`);

    // Imagem substituída com outra extensão: remove o arquivo antigo
    if (existing?.image_path && existing.image_path !== path) {
      await context.supabase.storage.from("pieces").remove([existing.image_path]);
    }

    const { error: insErr } = await context.supabase.from("pieces").upsert(
      {
        code,
        product_code: productCode,
        name: data.name ?? null,
        category: data.category ?? "anel",
        image_path: path,
        embedding_v2: JSON.stringify(data.embeddingV2) as unknown as string,
        created_by: context.userId,
      },
      { onConflict: "code" },
    );
    if (insErr) throw new Error(insErr.message);
    return {
      ok: true,
      code,
      productCode,
      action: existing ? ("updated" as const) : ("created" as const),
    };
  });


/**
 * Renomeia uma peça (código e/ou nome de exibição).
 * O embedding é preservado — renomear não afeta a busca por imagem.
 * Quando o código muda, o arquivo no armazenamento é movido junto.
 */
export const renamePiece = createServerFn({ method: "POST" })
  .middleware([requireApprovedUser])
  .inputValidator((i: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        code: z.string().min(1).max(50),
        name: z.string().max(120).optional(),
        category: z.string().max(40).optional(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { data: role } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!role) throw new Error("Apenas administradores.");

    const newCode = data.code.trim().toUpperCase();
    if (!newCode) throw new Error("Código inválido.");

    const { data: piece, error: getErr } = await context.supabase
      .from("pieces")
      .select("id, code, image_path, product_code")
      .eq("id", data.id)
      .maybeSingle();
    if (getErr) throw new Error(getErr.message);
    if (!piece) throw new Error("Peça não encontrada.");

    const newName = data.name?.trim() ? data.name.trim() : null;

    if (newCode !== piece.code) {
      const { data: clash } = await context.supabase
        .from("pieces")
        .select("id")
        .eq("code", newCode)
        .maybeSingle();
      if (clash && clash.id !== piece.id) {
        throw new Error(`Já existe uma peça com o código ${newCode}.`);
      }
    }

    let imagePath = piece.image_path;
    if (newCode !== piece.code) {
      const ext = piece.image_path.split(".").pop()?.toLowerCase() ?? "jpg";
      const target = `${newCode}.${ext}`;
      if (target !== piece.image_path) {
        const { error: mvErr } = await context.supabase.storage
          .from("pieces")
          .move(piece.image_path, target);
        if (mvErr) throw new Error(`Armazenamento: ${mvErr.message}`);
        imagePath = target;
      }
    }

    const patch: {
      code: string;
      name: string | null;
      image_path: string;
      product_code?: string;
      category?: string;
    } = {
      code: newCode,
      name: newName,
      image_path: imagePath,
    };
    if (data.category) patch.category = data.category;
    // Peça sem variantes: mantém o código de produto alinhado ao novo código.
    if (!piece.product_code || piece.product_code === piece.code) {
      patch.product_code = newCode;
    }

    const { error } = await context.supabase.from("pieces").update(patch).eq("id", data.id);

    if (error) throw new Error(error.message);

    return { ok: true, previousCode: piece.code, code: newCode, name: newName };
  });

export const deletePiece = createServerFn({ method: "POST" })

  .middleware([requireApprovedUser])
  .inputValidator((i: unknown) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { data: role } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!role) throw new Error("Apenas administradores.");
    const { data: piece } = await context.supabase
      .from("pieces")
      .select("image_path")
      .eq("id", data.id)
      .maybeSingle();
    if (piece?.image_path) {
      await context.supabase.storage.from("pieces").remove([piece.image_path]);
    }
    const { error } = await context.supabase.from("pieces").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

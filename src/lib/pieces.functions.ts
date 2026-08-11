import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const GATEWAY = "https://ai.gateway.lovable.dev/v1/embeddings";

async function embedImage(dataUrl: string, hint: string): Promise<number[]> {
  const key = process.env.LOVABLE_API_KEY;
  if (!key) throw new Error("Missing LOVABLE_API_KEY");
  const r = await fetch(GATEWAY, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "google/gemini-embedding-2",
      input: [
        {
          content: [
            { type: "text", text: hint },
            { type: "image_url", image_url: { url: dataUrl } },
          ],
        },
      ],
    }),
  });
  if (!r.ok) {
    const txt = await r.text();
    throw new Error(`Embedding failed [${r.status}]: ${txt.slice(0, 300)}`);
  }
  const json = (await r.json()) as { data: Array<{ embedding: number[] }> };
  return json.data[0].embedding;
}

const SHAPE_HINT =
  "Jewelry piece identification by GEOMETRY ONLY. The query may be an unplated raw casting (brass/silver-colored, matte) while the catalog item is the same model finished with gold plating. Match strictly on outline, silhouette, contour, proportions, structure, number and arrangement of elements, stone settings shape and layout. Completely ignore color, hue, metal tone, plating, polish, gloss, reflections, specular highlights, shadows, background and lighting.";

type MatchRow = {
  id: string;
  code: string;
  name: string | null;
  image_path: string;
  category: string | null;
  product_code?: string | null;
  similarity: number;
};

// PUBLIC-ISH: authenticated user can search
export const searchByImage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        imageDataUrl: z.string().min(20),
        // versão da mesma foto normalizada no cliente (cinza, sem fundo/iluminação)
        shapeDataUrl: z.string().min(20).optional(),
        limit: z.number().min(1).max(80).default(36),
        category: z.string().optional(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const variants: Array<{ url: string; weight: number }> = [
      { url: data.imageDataUrl, weight: 1 },
    ];
    if (data.shapeDataUrl && data.shapeDataUrl !== data.imageDataUrl) {
      variants.push({ url: data.shapeDataUrl, weight: 1.35 });
    }

    const pool = Math.min(80, Math.max(data.limit * 2, data.limit + 24));

    const runs = await Promise.all(
      variants.map(async (v) => {
        const emb = await embedImage(v.url, SHAPE_HINT);
        const { data: matches, error } = await context.supabase.rpc("match_pieces", {
          query_embedding: emb as unknown as string,
          match_count: pool,
          filter_category: data.category ?? null,
        } as never);
        if (error) throw new Error(error.message);
        return { weight: v.weight, rows: (matches ?? []) as MatchRow[] };
      }),
    );

    // Fusão de rankings (RRF ponderada): favorece peças que aparecem bem
    // colocadas tanto na foto original quanto na versão focada em formato.
    const scores = new Map<string, number>();
    const best = new Map<string, MatchRow>();
    for (const run of runs) {
      run.rows.forEach((row, idx) => {
        scores.set(row.id, (scores.get(row.id) ?? 0) + run.weight / (12 + idx));
        const prev = best.get(row.id);
        if (!prev || row.similarity > prev.similarity) best.set(row.id, row);
      });
    }

    // Várias fotos podem pertencer ao mesmo produto: mantém apenas a melhor
    // ocorrência de cada produto no resultado.
    const seenProduct = new Set<string>();
    const rows = [...scores.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([id]) => best.get(id)!)
      .filter(Boolean)
      .filter((r) => {
        const key = r.product_code || r.code;
        if (seenProduct.has(key)) return false;
        seenProduct.add(key);
        return true;
      })
      .slice(0, data.limit);

    if (rows.length === 0) return [] as Array<MatchRow & { created_at: string | null }>;
    const ids = rows.map((r) => r.id);
    const { data: meta } = await context.supabase
      .from("pieces")
      .select("id, created_at")
      .in("id", ids);
    const map = new Map<string, string>();
    for (const m of meta ?? []) map.set(m.id, m.created_at as unknown as string);
    return rows.map((r) => ({ ...r, created_at: map.get(r.id) ?? null }));
  });


export const searchByText = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
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
  .middleware([requireSupabaseAuth])
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
  .middleware([requireSupabaseAuth])
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
  .middleware([requireSupabaseAuth])
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
  .middleware([requireSupabaseAuth])
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
        embeddingV2: z.array(z.number()).length(384).optional(),
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

    // Sem vetor do navegador, cai no gerador antigo (consome créditos de IA).
    const legacyEmb = data.embeddingV2
      ? null
      : await embedImage(data.imageDataUrl, `${SHAPE_HINT} Catalog item code ${code}.`);

    const { error: insErr } = await context.supabase.from("pieces").upsert(
      {
        code,
        product_code: productCode,
        name: data.name ?? null,
        category: data.category ?? "anel",
        image_path: path,
        ...(legacyEmb ? { embedding: legacyEmb as unknown as string } : {}),
        ...(data.embeddingV2
          ? { embedding_v2: JSON.stringify(data.embeddingV2) as unknown as string }
          : {}),
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
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        code: z.string().min(1).max(50),
        name: z.string().max(120).optional(),
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
    } = {
      code: newCode,
      name: newName,
      image_path: imagePath,
    };
    // Peça sem variantes: mantém o código de produto alinhado ao novo código.
    if (!piece.product_code || piece.product_code === piece.code) {
      patch.product_code = newCode;
    }

    const { error } = await context.supabase.from("pieces").update(patch).eq("id", data.id);

    if (error) throw new Error(error.message);

    return { ok: true, previousCode: piece.code, code: newCode, name: newName };
  });

export const deletePiece = createServerFn({ method: "POST" })

  .middleware([requireSupabaseAuth])
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

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

type MatchRow = {
  id: string;
  code: string;
  name: string | null;
  image_path: string;
  category: string | null;
  product_code?: string | null;
  similarity: number;
};

const vectorSchema = z.array(z.number()).length(384);

/**
 * Busca por imagem usando o índice v2 (vetores gerados no navegador).
 * O servidor não gera embeddings — apenas compara os vetores recebidos.
 */
export const searchByVectorV2 = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        vectors: z
          .array(z.object({ vector: vectorSchema, weight: z.number().min(0).max(5).default(1) }))
          .min(1)
          .max(3),
        limit: z.number().min(1).max(80).default(36),
        category: z.string().optional(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    // result_count = quantidade pedida pelo usuário (36/48/60)
    // candidate_count = candidatos recuperados no banco, com folga para
    // filtro de categoria, ranking e deduplicação por produto.
    const resultCount = data.limit;
    const candidateCount = Math.min(400, resultCount * 5);
    // Profundidade de exploração do índice HNSW escolhida por teste
    // comparativo (100/200/300/500): 100 já preenche as cotas de 36/48/60,
    // com e sem categoria, com a menor latência.
    const efSearch = 100;

    async function fetchRuns(candidates: number, ef: number) {
      return await Promise.all(
        data.vectors.map(async (v) => {
          const { data: matches, error } = await context.supabase.rpc("match_pieces_v2", {
            query_embedding: JSON.stringify(v.vector) as unknown as string,
            match_count: candidates,
            filter_category: data.category ?? null,
            ef_search: ef,
          } as never);
          if (error) throw new Error(error.message);
          return { weight: v.weight, rows: (matches ?? []) as MatchRow[] };
        }),
      );
    }

    function rank(runs: Array<{ weight: number; rows: MatchRow[] }>) {
      // Fusão de rankings ponderada (RRF)
      const scores = new Map<string, number>();
      const best = new Map<string, MatchRow>();
      for (const run of runs) {
        run.rows.forEach((row, idx) => {
          scores.set(row.id, (scores.get(row.id) ?? 0) + run.weight / (12 + idx));
          const prev = best.get(row.id);
          if (!prev || row.similarity > prev.similarity) best.set(row.id, row);
        });
      }
      // Uma peça por produto (várias fotos podem ser do mesmo product_code).
      const seenProduct = new Set<string>();
      return [...scores.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([id]) => best.get(id)!)
        .filter(Boolean)
        .filter((r) => {
          const key = r.product_code || r.code;
          if (seenProduct.has(key)) return false;
          seenProduct.add(key);
          return true;
        });
    }

    let runs = await fetchRuns(candidateCount, efSearch);
    let ranked = rank(runs);

    // Segunda passada mais profunda apenas se faltarem produtos e ainda
    // houver candidatos a explorar — nunca duplicando nem forçando itens.
    const gotAllCandidates = runs.every((r) => r.rows.length < candidateCount);
    if (ranked.length < resultCount && !gotAllCandidates) {
      const deeper = Math.min(1000, candidateCount * 3);
      runs = await fetchRuns(Math.min(500, deeper), Math.min(400, efSearch * 3));
      ranked = rank(runs);
    }

    const rows = ranked.slice(0, resultCount);

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


/** Progresso da reindexação (quantas peças já têm vetor no índice novo). */
export const getIndexV2Stats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase.rpc("index_v2_stats" as never);
    if (error) throw new Error(error.message);
    const row = (Array.isArray(data) ? data[0] : data) as { total: number; indexed: number } | null;
    return { total: Number(row?.total ?? 0), indexed: Number(row?.indexed ?? 0) };
  });

async function assertAdmin(context: { supabase: any; userId: string }) {
  const { data: role } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  if (!role) throw new Error("Apenas administradores podem reindexar.");
}

/** Lote de peças ainda sem vetor no índice novo, com links temporários das fotos. */
export const nextReindexBatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ size: z.number().min(1).max(100).default(50) }).parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(context as never);
    // Ponto de partida aleatório: permite reindexar em várias abas/computadores
    // ao mesmo tempo sem que dois processos peguem as mesmas peças.
    const nibble = "0123456789abcdef"[Math.floor(Math.random() * 16)];
    const startId = `${nibble}0000000-0000-0000-0000-000000000000`;

    async function fetchBatch(from: string | null) {
      let q = context.supabase
        .from("pieces")
        .select("id, code, image_path")
        .is("embedding_v2", null)
        .order("id", { ascending: true })
        .limit(data.size);
      if (from) q = q.gte("id", from);
      const { data: rows, error } = await q;
      if (error) throw new Error(error.message);
      return rows ?? [];
    }

    let list = await fetchBatch(startId);
    if (list.length === 0) list = await fetchBatch(null);
    if (list.length === 0) return { items: [] as Array<{ id: string; code: string; url: string }> };


    const { data: signed, error: sErr } = await context.supabase.storage
      .from("pieces")
      .createSignedUrls(
        list.map((r) => r.image_path),
        3600,
      );
    if (sErr) throw new Error(sErr.message);

    const items = list
      .map((r, idx) => ({ id: r.id, code: r.code, url: signed?.[idx]?.signedUrl ?? "" }))
      .filter((r) => r.url);
    return { items };
  });

/** Grava os vetores calculados no navegador. */
export const saveVectorsV2 = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        items: z.array(z.object({ id: z.string().uuid(), vector: vectorSchema })).min(1).max(100),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context as never);
    // Gravação em massa: uma única chamada ao banco para todo o lote.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: saved, error } = await supabaseAdmin.rpc("save_vectors_v2" as never, {
      payload: data.items.map((i) => ({ id: i.id, vector: i.vector })),
    } as never);
    if (error) throw new Error(error.message);
    return { saved: Number(saved ?? data.items.length) };
  });

/** Marca uma peça como não indexada (usado quando a foto muda). */
export const clearVectorV2 = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(context as never);
    const { error } = await context.supabase
      .from("pieces")
      .update({ embedding_v2: null })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

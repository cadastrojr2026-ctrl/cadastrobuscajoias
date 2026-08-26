#!/usr/bin/env node
/**
 * Experimento embedding_v2_shape — Passo 1: seleção da amostra.
 *
 * Leitura SOMENTE (SELECT) na tabela `pieces`, via anon key pública — a
 * mesma que já está embutida no bundle do app. A policy de RLS
 * "Anyone can view pieces" (using (true)) já libera essa leitura para
 * `anon`; nenhuma credencial administrativa é usada ou necessária aqui.
 *
 * NÃO grava nada no Supabase. A única escrita deste script é o arquivo
 * local `data/sample.local.json` (padrão `*.local` já ignorado pelo git).
 *
 * Uso previsto (NÃO executado nesta etapa):
 *   node scripts/ab-shape/01-select-sample.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = join(HERE, "data", "sample.local.json");

const SAMPLE_SIZE = 300;
const SEED = 20260825; // fixa, gravada no arquivo de saída para reprodutibilidade

function assertNoServiceRole() {
  if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error(
      "[abort] Este script não usa SUPABASE_SERVICE_ROLE_KEY. Remova essa variável do ambiente antes de rodar.",
    );
    process.exit(1);
  }
}

/** PRNG determinístico (mulberry32) — só para o sorteio da amostra, não para segurança. */
function mulberry32(seed) {
  let a = seed;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffleDeterministic(arr, rand) {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

async function main() {
  assertNoServiceRole();

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const ANON_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!SUPABASE_URL || !ANON_KEY) {
    console.error("[abort] Defina SUPABASE_URL e SUPABASE_PUBLISHABLE_KEY (anon) no ambiente.");
    process.exit(1);
  }

  const supabase = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });

  console.log("Lendo pieces (SELECT, anon key, somente leitura)...");
  // PostgREST limita cada resposta a 1000 linhas por padrão — o catálogo tem
  // ~21 mil peças, então é preciso paginar com .range() até esgotar. Uma
  // chamada única aqui truncaria silenciosamente a amostra nas primeiras
  // 1000 linhas (ordem física do banco, não representativa).
  const PAGE = 1000;
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const { data: page, error } = await supabase
      .from("pieces")
      .select("id, code, product_code, category, image_path, embedding_v2")
      .not("embedding_v2", "is", null)
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`Falha ao ler pieces: ${error.message}`);
    rows.push(...(page ?? []));
    if (!page || page.length < PAGE) break;
  }

  // PostgREST devolve pgvector como string JSON ("[0.01,-0.02,...]"), não
  // como array nativo — mesma convenção já usada no resto do projeto (ver
  // vector.functions.ts). Normaliza aqui para número[] antes de qualquer
  // validação/uso downstream.
  for (const r of rows) {
    if (typeof r.embedding_v2 === "string") r.embedding_v2 = JSON.parse(r.embedding_v2);
  }
  if (!rows || rows.length === 0) {
    console.error("[abort] Nenhuma peça com embedding_v2 encontrada.");
    process.exit(1);
  }
  console.log(`Total de peças com embedding_v2: ${rows.length}`);

  // 1 foto por produto: agrupa por product_code (fallback: code) e escolhe a
  // de menor `code` — determinístico, sem depender de created_at.
  const byProduct = new Map();
  for (const r of rows) {
    const key = r.product_code || r.code;
    const current = byProduct.get(key);
    if (!current || r.code < current.code) byProduct.set(key, r);
  }
  const products = [...byProduct.values()];
  console.log(`Produtos distintos (1 foto cada): ${products.length}`);

  // Distribuição de categorias no universo de produtos elegíveis.
  const byCategory = new Map();
  for (const p of products) {
    const cat = p.category || "outros";
    if (!byCategory.has(cat)) byCategory.set(cat, []);
    byCategory.get(cat).push(p);
  }

  const targetTotal = Math.min(SAMPLE_SIZE, products.length);
  const rand = mulberry32(SEED);
  const sample = [];
  for (const [cat, items] of byCategory) {
    const quota = Math.max(1, Math.round((items.length / products.length) * targetTotal));
    const picked = shuffleDeterministic(items, rand).slice(0, quota);
    sample.push(...picked);
  }
  // Ajuste fino: se o arredondamento por categoria passou do alvo, corta o excedente
  // (mantendo a ordem já embaralhada, então o corte não favorece nenhuma categoria).
  const finalSample = shuffleDeterministic(sample, rand).slice(0, targetTotal);

  const out = {
    generatedAt: new Date().toISOString(),
    seed: SEED,
    sourceUniverse: {
      totalPiecesWithEmbeddingV2: rows.length,
      totalDistinctProducts: products.length,
    },
    sampleSize: finalSample.length,
    items: finalSample.map((r) => ({
      piece_id: r.id,
      code: r.code,
      product_code: r.product_code || r.code,
      category: r.category,
      image_path: r.image_path,
      embedding_v2: r.embedding_v2,
    })),
  };

  await mkdir(dirname(OUT_PATH), { recursive: true });
  await writeFile(OUT_PATH, JSON.stringify(out, null, 2), "utf-8");
  console.log(`Amostra gravada em ${OUT_PATH} (${finalSample.length} produtos).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

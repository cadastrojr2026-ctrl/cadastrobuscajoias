#!/usr/bin/env node
/**
 * Experimento embedding_v2_shape — Passo 2b: consultas perturbadas (Modalidade B).
 *
 * TESTE SINTÉTICO CONTROLADO — a transformação aplicada (dessaturação +
 * achatamento de brilho + redução de contraste, ver harness/perturb.ts) não
 * simula uma foto real de peça bruta; serve só para testar, de forma
 * controlada e reprodutível, a robustez de embedding_v2 vs
 * embedding_v2_shape a variações de cor/brilho/contraste sem alterar
 * geometria/enquadramento.
 *
 * Para cada peça de data/sample.local.json:
 *   1. baixa a foto original do Storage (leitura, mesma policy pública já
 *      usada por 02-embed-shape.mjs);
 *   2. abre o harness (mesma página/Chromium headless de 02-embed-shape.mjs);
 *   3. roda, dentro do navegador:
 *        perturbed = degradeColorContrastForTest(dataUrl)
 *        query_A   = embedImageSource(perturbed)                              [sem shape]
 *        query_B   = embedImageSource(normalizeForShapeSearch(perturbed))     [com shape]
 *   4. acumula { piece_id, code, queryA, queryB } em memória.
 *
 * NÃO grava nada no Supabase. Única escrita: data/perturbed-vectors.local.json.
 *
 * Uso previsto (NÃO executado nesta etapa):
 *   node scripts/ab-shape/02b-embed-perturbed.mjs
 */
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SAMPLE_PATH = join(HERE, "data", "sample.local.json");
const OUT_PATH = join(HERE, "data", "perturbed-vectors.local.json");
const HARNESS_URL =
  process.env.AB_SHAPE_HARNESS_URL ?? "http://localhost:5173/scripts/ab-shape/harness/index.html";

function assertNoServiceRole() {
  if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error(
      "[abort] Este script não usa SUPABASE_SERVICE_ROLE_KEY. Remova essa variável do ambiente antes de rodar.",
    );
    process.exit(1);
  }
}

/**
 * Baixa a imagem do bucket "pieces" via storage.download() (client anon) —
 * não via o endpoint /object/public/, que exige o bucket marcado "public"
 * na configuração do Storage (não é o caso aqui: o bucket é privado e a
 * leitura é liberada só pela RLS policy "Anyone can view piece images",
 * que .download() respeita normalmente).
 */
async function fetchAsDataUrl(supabase, imagePath) {
  const { data, error } = await supabase.storage.from("pieces").download(imagePath);
  if (error || !data) throw new Error(`Falha ao baixar ${imagePath}: ${error?.message ?? "sem dados"}`);
  const buf = Buffer.from(await data.arrayBuffer());
  const ext = imagePath.split(".").pop()?.toLowerCase();
  const mime = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
  return `data:${mime};base64,${buf.toString("base64")}`;
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

  const sample = JSON.parse(await readFile(SAMPLE_PATH, "utf-8"));
  console.log(`Amostra carregada: ${sample.items.length} peças (gerada em ${sample.generatedAt}).`);

  console.log(`Abrindo Chromium headless e navegando para ${HARNESS_URL} ...`);
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(HARNESS_URL, { waitUntil: "networkidle" });
  await page.waitForFunction(() => window.__abShape?.ready === true, { timeout: 30_000 });
  console.log("Harness pronto (window.__abShape.ready === true).");

  const t0 = Date.now();
  const results = [];
  const errors = [];
  for (let i = 0; i < sample.items.length; i++) {
    const item = sample.items[i];
    try {
      const dataUrl = await fetchAsDataUrl(supabase, item.image_path);
      const { queryA, queryB } = await page.evaluate(async (imgDataUrl) => {
        const perturbed = await window.__abShape.degradeColorContrastForTest(imgDataUrl);
        const queryA = await window.__abShape.embedImageSource(perturbed);
        const shaped = await window.__abShape.normalizeForShapeSearch(perturbed);
        const queryB = await window.__abShape.embedImageSource(shaped);
        return { queryA, queryB };
      }, dataUrl);
      results.push({ piece_id: item.piece_id, code: item.code, queryA, queryB });
    } catch (err) {
      errors.push({ piece_id: item.piece_id, code: item.code, message: String(err?.message ?? err) });
    }
    if ((i + 1) % 25 === 0 || i === sample.items.length - 1) {
      const elapsedS = ((Date.now() - t0) / 1000).toFixed(0);
      console.log(
        `progresso ${i + 1}/${sample.items.length} — ok=${results.length} erro=${errors.length} — ${elapsedS}s decorridos`,
      );
    }
    if (errors.length >= 20 && results.length === 0) {
      console.error("[abort] 20 falhas consecutivas sem nenhum sucesso — abortando para diagnóstico.");
      break;
    }
  }

  await browser.close();

  const out = {
    generatedAt: new Date().toISOString(),
    sourceSample: SAMPLE_PATH,
    modality: "B — consulta perturbada (teste sintético controlado, não é foto real)",
    transform: {
      steps: [
        "dessaturação HSL para 15% da saturação original",
        "achatamento de brilho: valores de luminância acima do P85 comprimidos para o P85 (rescala uniforme de RGB)",
        "redução de contraste: 70% imagem + 30% cinza médio (128)",
      ],
      excluded: ["ruído gaussiano (descartado)", "resize", "crop", "rotação", "flip", "qualquer alteração de enquadramento"],
    },
    total: sample.items.length,
    ok: results.length,
    failed: errors.length,
    errors,
    vectors: results,
  };
  await mkdir(dirname(OUT_PATH), { recursive: true });
  await writeFile(OUT_PATH, JSON.stringify(out, null, 2), "utf-8");
  console.log(`Vetores perturbados gravados em ${OUT_PATH} (${results.length} ok, ${errors.length} falhas).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

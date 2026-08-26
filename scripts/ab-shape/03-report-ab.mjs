#!/usr/bin/env node
/**
 * Experimento embedding_v2_shape — Passo 3: relatório A/B (CORRIGIDO).
 *
 * Correção de metodologia (versão anterior comparava A contra o catálogo
 * inteiro via RPC match_pieces_v2 e B só contra a amostra — comparação
 * injusta). Agora os dois braços usam o MESMO universo de candidatos (as
 * ~300 peças de data/sample.local.json) e rodam 100% em memória, via
 * cosseno — nenhuma chamada de rede, nenhuma RPC, nenhum acesso ao
 * Supabase (nem leitura, nem escrita) neste script.
 *
 * candidatesA = embedding_v2 já armazenado de cada peça da amostra (de sample.local.json)
 * candidatesB = embedding_v2_shape de cada peça da amostra (de shape-vectors.local.json,
 *               calculado sobre a foto ORIGINAL/não perturbada — é o lado "catálogo")
 *
 * Modalidade A — auto-consulta (DIAGNÓSTICO, NÃO decide nada):
 *   consulta = o próprio vetor (embedding_v2 ou shape) da peça, contra os
 *   mesmos candidatos que o incluem. Por identidade matemática, a própria
 *   peça deve ficar em 1º lugar (similaridade ~1,0) — isso é ESPERADO, não
 *   é um resultado a favor de A ou de B. Serve só para checar consistência
 *   do pipeline (ex.: detectar embedding não determinístico ou vetor
 *   corrompido). Nunca entra nas métricas de decisão.
 *
 * Modalidade B — consulta perturbada (DECISÃO):
 *   consulta = embedding da foto ORIGINAL após uma transformação sintética
 *   controlada de cor/brilho/contraste (ver harness/perturb.ts e
 *   02b-embed-perturbed.mjs), contra os candidatos ORIGINAIS (não
 *   perturbados). Como a consulta não é idêntica a nenhum candidato, não há
 *   domínio trivial — o candidato correto precisa vencer por semelhança
 *   real, sobrevivendo à degradação de cor/brilho/contraste. Esta é a
 *   modalidade que produz Recall/MRR/Precision/comparação pareada.
 *
 * IMPORTANTE — a transformação da Modalidade B é um TESTE SINTÉTICO
 * CONTROLADO, não uma simulação de foto real de peça bruta. O aviso abaixo
 * é reproduzido literalmente no relatório final.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SAMPLE_PATH = join(HERE, "data", "sample.local.json");
const SHAPE_VECTORS_PATH = join(HERE, "data", "shape-vectors.local.json");
const PERTURBED_VECTORS_PATH = join(HERE, "data", "perturbed-vectors.local.json");
const OUT_JSON = join(HERE, "data", "report.local.json");
const OUT_MD = join(HERE, "data", "report.local.md");

const RECALL_KS = [1, 5, 10, 36];

const MODALIDADE_B_DISCLAIMER =
  "Modalidade B utiliza uma perturbação sintética de cor/brilho/contraste para testar a robustez da representação visual. Os resultados não substituem o teste posterior com fotos reais.";

function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

/** Ordena `candidates` por similaridade decrescente à consulta `queryVec`. */
function rankAgainst(queryVec, candidates) {
  return candidates
    .map((c) => ({ product_code: c.product_code, similarity: cosine(queryVec, c.vector) }))
    .sort((x, y) => y.similarity - x.similarity);
}

/** Posição (1-based) do primeiro resultado com o product_code correto; null se não achar. */
function firstHitPosition(rankedRows, correctProductCode) {
  for (let i = 0; i < rankedRows.length; i++) {
    if (rankedRows[i].product_code === correctProductCode) return i + 1;
  }
  return null;
}

function recallAt(positions, k) {
  const hits = positions.filter((p) => p !== null && p <= k).length;
  return positions.length ? hits / positions.length : 0;
}

function precisionAt(rankedRowsList, correctProductCodes, k) {
  let sum = 0;
  for (let i = 0; i < rankedRowsList.length; i++) {
    const top = rankedRowsList[i].slice(0, k);
    const relevant = top.filter((r) => r.product_code === correctProductCodes[i]).length;
    sum += relevant / k;
  }
  return rankedRowsList.length ? sum / rankedRowsList.length : 0;
}

function mrr(positions) {
  const sum = positions.reduce((s, p) => s + (p ? 1 / p : 0), 0);
  return positions.length ? sum / positions.length : 0;
}

function percentile(sortedMs, p) {
  if (sortedMs.length === 0) return 0;
  const idx = Math.min(sortedMs.length - 1, Math.floor((p / 100) * sortedMs.length));
  return sortedMs[idx];
}

async function tryReadJson(path) {
  try {
    return JSON.parse(await readFile(path, "utf-8"));
  } catch (err) {
    if (err.code === "ENOENT") return null;
    throw err;
  }
}

async function main() {
  const sample = await tryReadJson(SAMPLE_PATH);
  if (!sample) {
    console.error(`[abort] ${SAMPLE_PATH} não existe — rode 01-select-sample.mjs primeiro.`);
    process.exit(1);
  }
  const shapeData = await tryReadJson(SHAPE_VECTORS_PATH);
  if (!shapeData) {
    console.error(`[abort] ${SHAPE_VECTORS_PATH} não existe — rode 02-embed-shape.mjs primeiro.`);
    process.exit(1);
  }
  const perturbedData = await tryReadJson(PERTURBED_VECTORS_PATH);
  if (!perturbedData) {
    console.error(
      `[abort] ${PERTURBED_VECTORS_PATH} não existe — rode 02b-embed-perturbed.mjs primeiro. ` +
        "Sem ele, não há dado para a Modalidade B (a única que produz métricas de decisão) — " +
        "não vou fabricar números.",
    );
    process.exit(1);
  }

  const shapeByPieceId = new Map(shapeData.vectors.map((v) => [v.piece_id, v.vector]));
  const perturbedByPieceId = new Map(perturbedData.vectors.map((v) => [v.piece_id, v]));

  // Só entram no experimento peças com embedding_v2 (amostra), vetor de
  // forma do catálogo (passo 2) E consulta perturbada (passo 2b) disponíveis.
  const items = sample.items.filter(
    (it) => shapeByPieceId.has(it.piece_id) && perturbedByPieceId.has(it.piece_id),
  );
  const skipped = sample.items.length - items.length;
  if (skipped > 0) {
    console.warn(`Aviso: ${skipped} peça(s) da amostra sem vetor de forma e/ou perturbado — excluídas.`);
  }
  if (items.length === 0) {
    console.error("[abort] Nenhum item com dados completos (embedding_v2 + shape + perturbado).");
    process.exit(1);
  }

  // Mesmo universo de ~300 candidatos para os dois braços — nada de RPC,
  // nada de catálogo inteiro. Esta é a correção central desta versão.
  const candidatesA = items.map((it) => ({ product_code: it.product_code, vector: it.embedding_v2 }));
  const candidatesB = items.map((it) => ({ product_code: it.product_code, vector: shapeByPieceId.get(it.piece_id) }));

  // ---------------------------------------------------------------------
  // Modalidade A — auto-consulta (diagnóstico de sanidade, NÃO é decisão)
  // ---------------------------------------------------------------------
  // A amostra é 1 foto por produto (01-select-sample.mjs), então
  // product_code já identifica a peça de forma única dentro da amostra —
  // usamos firstHitPosition(..., it.product_code) direto, sem indireção.
  const sanity = { checkedA: 0, checkedB: 0, selfNotRank1_A: [], selfNotRank1_B: [] };
  for (const it of items) {
    const rankedA = rankAgainst(it.embedding_v2, candidatesA);
    const posA = firstHitPosition(rankedA, it.product_code);
    sanity.checkedA++;
    if (posA !== 1) sanity.selfNotRank1_A.push({ piece_id: it.piece_id, code: it.code, position: posA });

    const rankedB = rankAgainst(shapeByPieceId.get(it.piece_id), candidatesB);
    const posB = firstHitPosition(rankedB, it.product_code);
    sanity.checkedB++;
    if (posB !== 1) sanity.selfNotRank1_B.push({ piece_id: it.piece_id, code: it.code, position: posB });
  }

  // ---------------------------------------------------------------------
  // Modalidade B — consulta perturbada (produz as métricas de decisão)
  // ---------------------------------------------------------------------
  const positionsA = [];
  const positionsB = [];
  const rowsA = [];
  const rowsB = [];
  const latA = [];
  const latB = [];
  const perQuery = [];

  for (const it of items) {
    const perturbed = perturbedByPieceId.get(it.piece_id);

    const t0a = performance.now();
    const rankedA = rankAgainst(perturbed.queryA, candidatesA);
    latA.push(performance.now() - t0a);
    rowsA.push(rankedA);
    const posA = firstHitPosition(rankedA, it.product_code);
    positionsA.push(posA);

    const t0b = performance.now();
    const rankedB = rankAgainst(perturbed.queryB, candidatesB);
    latB.push(performance.now() - t0b);
    rowsB.push(rankedB);
    const posB = firstHitPosition(rankedB, it.product_code);
    positionsB.push(posB);

    perQuery.push({
      piece_id: it.piece_id,
      code: it.code,
      product_code: it.product_code,
      category: it.category,
      positionA: posA,
      positionB: posB,
      top1A: posA === 1,
      top1B: posB === 1,
      top5A: posA !== null && posA <= 5,
      top5B: posB !== null && posB <= 5,
    });
  }

  const correctCodes = items.map((it) => it.product_code);
  const summary = {
    queries: items.length,
    A: {
      recall: Object.fromEntries(RECALL_KS.map((k) => [`@${k}`, recallAt(positionsA, k)])),
      mrr: mrr(positionsA),
      precisionAt5: precisionAt(rowsA, correctCodes, 5),
      precisionAt10: precisionAt(rowsA, correctCodes, 10),
      latencyMsP50: percentile([...latA].sort((x, y) => x - y), 50),
      latencyMsP95: percentile([...latA].sort((x, y) => x - y), 95),
    },
    B: {
      recall: Object.fromEntries(RECALL_KS.map((k) => [`@${k}`, recallAt(positionsB, k)])),
      mrr: mrr(positionsB),
      precisionAt5: precisionAt(rowsB, correctCodes, 5),
      precisionAt10: precisionAt(rowsB, correctCodes, 10),
      latencyMsP50: percentile([...latB].sort((x, y) => x - y), 50),
      latencyMsP95: percentile([...latB].sort((x, y) => x - y), 95),
    },
  };

  const melhoria = perQuery.filter((q) => !q.top1A && q.top1B);
  const regressao = perQuery.filter((q) => q.top1A && !q.top1B);
  const empatados = perQuery.filter((q) => q.top1A === q.top1B);

  const n = items.length;
  const noteSignificancia =
    n < 100
      ? `Amostra de ${n} consultas — pequena demais para declarar significância estatística (McNemar) com confiança. Não declarar "B é melhor/pior" com base só nisso.`
      : `Amostra de ${n} consultas — aplicar teste de McNemar pareado sobre melhoria/regressão antes de qualquer conclusão de significância.`;

  const report = {
    generatedAt: new Date().toISOString(),
    disclaimer: MODALIDADE_B_DISCLAIMER,
    universoDeCandidatos: `mesmas ${items.length} peças da amostra, nos dois braços (sem RPC, sem catálogo inteiro)`,
    modalidadeA_sanidade: {
      descricao:
        "Auto-consulta — a própria peça deve ficar em 1º lugar por identidade matemática. Diagnóstico apenas, não usado para decidir A vs B.",
      checkedA: sanity.checkedA,
      checkedB: sanity.checkedB,
      anomaliasA: sanity.selfNotRank1_A,
      anomaliasB: sanity.selfNotRank1_B,
    },
    modalidadeB_decisao: { summary },
    casosDeMelhoria: melhoria,
    casosDeRegressao: regressao,
    casosEmpatados: empatados.length,
    noteSignificancia,
    perQuery,
    caveats: [
      MODALIDADE_B_DISCLAIMER,
      "Ground truth = product_code original da peça que originou a foto perturbada (não muda com a transformação).",
      "As ~40 fotos reais de peça bruta não fazem parte deste relatório (dados inexistentes no repositório) — quando existirem, repetem esta mesma lógica de Modalidade B com foto real em vez de sintética.",
    ],
  };

  await mkdir(dirname(OUT_JSON), { recursive: true });
  await writeFile(OUT_JSON, JSON.stringify(report, null, 2), "utf-8");

  const anomA = sanity.selfNotRank1_A.length;
  const anomB = sanity.selfNotRank1_B.length;
  const md = `# Relatório A/B — embedding_v2 vs embedding_v2_shape

Gerado em ${report.generatedAt}. Consultas válidas: ${n}. Universo de candidatos: ${report.universoDeCandidatos}.

> ${MODALIDADE_B_DISCLAIMER}

## Modalidade A — auto-consulta (diagnóstico de sanidade, NÃO é decisão)

- Braço A: ${sanity.checkedA} peças verificadas, ${anomA} fora da posição 1 (esperado: 0).
- Braço B: ${sanity.checkedB} peças verificadas, ${anomB} fora da posição 1 (esperado: 0).
${anomA + anomB > 0 ? "\n**Atenção:** anomalias detectadas — investigar antes de confiar nos vetores (ver `modalidadeA_sanidade` no JSON)." : ""}

## Modalidade B — consulta perturbada (decisão)

| Métrica | A (embedding_v2) | B (embedding_v2_shape) |
|---|---|---|
| Recall@1 | ${(summary.A.recall["@1"] * 100).toFixed(1)}% | ${(summary.B.recall["@1"] * 100).toFixed(1)}% |
| Recall@5 | ${(summary.A.recall["@5"] * 100).toFixed(1)}% | ${(summary.B.recall["@5"] * 100).toFixed(1)}% |
| Recall@10 | ${(summary.A.recall["@10"] * 100).toFixed(1)}% | ${(summary.B.recall["@10"] * 100).toFixed(1)}% |
| Recall@36 | ${(summary.A.recall["@36"] * 100).toFixed(1)}% | ${(summary.B.recall["@36"] * 100).toFixed(1)}% |
| MRR | ${summary.A.mrr.toFixed(3)} | ${summary.B.mrr.toFixed(3)} |
| Precision@5 | ${(summary.A.precisionAt5 * 100).toFixed(1)}% | ${(summary.B.precisionAt5 * 100).toFixed(1)}% |
| Precision@10 | ${(summary.A.precisionAt10 * 100).toFixed(1)}% | ${(summary.B.precisionAt10 * 100).toFixed(1)}% |
| Latência p50 (ms, ranking em memória) | ${summary.A.latencyMsP50.toFixed(2)} | ${summary.B.latencyMsP50.toFixed(2)} |
| Latência p95 (ms, ranking em memória) | ${summary.A.latencyMsP95.toFixed(2)} | ${summary.B.latencyMsP95.toFixed(2)} |

## Casos de melhoria (A errou top-1, B acertou): ${melhoria.length}
${melhoria.map((c) => `- ${c.code} (${c.product_code}) — posição A=${c.positionA ?? "—"}, B=${c.positionB ?? "—"}`).join("\n") || "_nenhum_"}

## Casos de regressão (A acertou top-1, B errou): ${regressao.length}
${regressao.map((c) => `- ${c.code} (${c.product_code}) — posição A=${c.positionA ?? "—"}, B=${c.positionB ?? "—"}`).join("\n") || "_nenhum_"}

## Empatados (mesmo resultado top-1 nos dois braços): ${empatados.length}

## Nota sobre significância

${noteSignificancia}

## Ressalvas

${report.caveats.map((c) => `- ${c}`).join("\n")}
`;
  await writeFile(OUT_MD, md, "utf-8");

  console.log(`Relatório gravado em:\n  ${OUT_JSON}\n  ${OUT_MD}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

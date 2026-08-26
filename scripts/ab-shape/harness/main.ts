/**
 * Harness do experimento embedding_v2_shape.
 *
 * Importa, sem alterar uma única linha, as funções reais do app que o
 * experimento precisa reproduzir fielmente:
 *
 *  - normalizeForShapeSearch:    src/lib/image-prep.ts (não tocado)
 *  - embedImageSource:           src/lib/dino-engine.ts (não tocado)
 *  - degradeColorContrastForTest: scripts/ab-shape/harness/perturb.ts —
 *    transformação sintética do experimento (Modalidade B), não faz parte
 *    do app, só existe aqui.
 *
 * Não é uma rota do app (não está registrada em src/routes) e não é
 * referenciada por nenhum código de produção. Só existe para o Playwright
 * abrir esta página via `vite dev` e chamar essas funções pelo
 * `window.__abShape`, a partir de scripts/ab-shape/02-embed-shape.mjs e
 * scripts/ab-shape/02b-embed-perturbed.mjs.
 */
import { normalizeForShapeSearch } from "@/lib/image-prep";
import { embedImageSource } from "@/lib/dino-engine";
import { degradeColorContrastForTest } from "./perturb";

declare global {
  interface Window {
    __abShape: {
      ready: boolean;
      normalizeForShapeSearch: typeof normalizeForShapeSearch;
      embedImageSource: typeof embedImageSource;
      degradeColorContrastForTest: typeof degradeColorContrastForTest;
    };
  }
}

window.__abShape = {
  ready: true,
  normalizeForShapeSearch,
  embedImageSource,
  degradeColorContrastForTest,
};

const statusEl = document.getElementById("status");
if (statusEl) statusEl.textContent = "pronto — window.__abShape disponível";

/**
 * Config Vite ISOLADA só para servir o harness do experimento
 * embedding_v2_shape (scripts/ab-shape/harness/). Não é usada pelo app —
 * o app roda via `vite dev` normal (TanStack Start/SSR, config em
 * vite.config.ts, não tocada). Este arquivo existe só porque o dev server
 * do TanStack Start intercepta toda rota via SSR e não serve HTML solto por
 * caminho de arquivo — nenhuma mudança na config principal foi necessária
 * ou feita.
 */
import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: here,
  // Alias "@" explícito, apontando para src/ (mesmo destino de "@/*" em
  // tsconfig.json). Nem o plugin vite-tsconfig-paths nem a resolução nativa
  // (resolve.tsconfigPaths) aplicaram o alias aqui — o tsconfig.json do
  // projeto só "include"s src/**, então scripts/ab-shape/harness/main.ts
  // fica fora do escopo desse tsconfig e o path-mapping não é aplicado a
  // ele. O alias explícito abaixo resolve isso sem tocar em tsconfig.json.
  resolve: { alias: { "@": resolve(here, "../../../src") } },
  server: {
    port: 5174,
    strictPort: true,
  },
});

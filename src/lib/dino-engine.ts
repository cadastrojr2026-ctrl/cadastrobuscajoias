/**
 * Geração de embeddings visuais 100% no navegador (gratuito, sem créditos).
 *
 * Modelo: DINOv2 (with registers, small) — treinado para *recuperação de
 * instância*, ou seja, encontrar exatamente o mesmo objeto em fotos
 * diferentes. Usamos o token CLS normalizado (384 dimensões).
 *
 * Este arquivo só pode ser importado dinamicamente em código de navegador.
 */

const MODEL_ID = "onnx-community/dinov2-with-registers-small";
export const DINO_DIMS = 384;

type Loaded = {
  processor: (img: unknown) => Promise<Record<string, unknown>>;
  model: (inputs: Record<string, unknown>) => Promise<{
    last_hidden_state: { data: Float32Array | number[]; dims: number[] };
  }>;
  fromURL: (url: string) => Promise<unknown>;
};

let loading: Promise<Loaded> | null = null;

async function pickDevice(): Promise<"webgpu" | "wasm"> {
  try {
    const gpu = (navigator as unknown as { gpu?: { requestAdapter: () => Promise<unknown> } }).gpu;
    if (gpu && (await gpu.requestAdapter())) return "webgpu";
  } catch {
    /* ignora */
  }
  return "wasm";
}

export function isModelReady() {
  return loading !== null;
}

export async function loadDino(): Promise<Loaded> {
  if (loading) return loading;
  loading = (async () => {
    const { AutoModel, AutoProcessor, RawImage, env } = await import("@huggingface/transformers");
    env.allowLocalModels = false;
    const device = await pickDevice();
    const [processor, model] = await Promise.all([
      AutoProcessor.from_pretrained(MODEL_ID),
      AutoModel.from_pretrained(MODEL_ID, { dtype: "fp32", device }),
    ]);
    return {
      processor: (img: unknown) => (processor as never as (i: unknown) => Promise<never>)(img),
      model: (inputs: Record<string, unknown>) =>
        (model as never as (i: unknown) => Promise<never>)(inputs),
      fromURL: (url: string) => RawImage.fromURL(url),
    } as Loaded;
  })();
  return loading;
}

/** Gera o vetor visual de uma imagem (data URL ou URL http). */
export async function embedImageSource(src: string): Promise<number[]> {
  const { processor, model, fromURL } = await loadDino();
  const image = await fromURL(src);
  const inputs = await processor(image);
  const out = await model(inputs);
  const hidden = out.last_hidden_state;
  const dim = hidden.dims[hidden.dims.length - 1];
  const raw = hidden.data as Float32Array | number[];
  // token CLS = primeira posição da sequência
  const vec = new Float64Array(dim);
  for (let i = 0; i < dim; i++) vec[i] = Number(raw[i]);
  let norm = 0;
  for (let i = 0; i < dim; i++) norm += vec[i] * vec[i];
  norm = Math.sqrt(norm) || 1;
  const outVec = new Array<number>(dim);
  for (let i = 0; i < dim; i++) outVec[i] = vec[i] / norm;
  return outVec;
}

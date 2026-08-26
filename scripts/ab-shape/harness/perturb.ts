/**
 * Transformação sintética de cor/brilho/contraste para a Modalidade B do
 * experimento embedding_v2_shape ("consulta perturbada").
 *
 * Aprovada explicitamente em 3 passos, SEM ruído (passo descartado) e SEM
 * qualquer alteração geométrica:
 *
 *   1. Dessaturação HSL para ~15% da saturação original.
 *   2. Achatamento do brilho: percentil 85 da luminância da própria imagem
 *      (já dessaturada, passo 1) — valores de luminância acima do P85 são
 *      comprimidos exatamente para o P85, por rescala uniforme do RGB
 *      (preserva matiz/cor relativa; não redesenha nem move pixel algum).
 *   3. Redução de contraste: mistura com cinza médio (128,128,128) a 30% de
 *      opacidade — resultado = 70% da imagem + 30% de cinza.
 *
 * TESTE SINTÉTICO CONTROLADO — não é uma simulação de foto real de peça
 * bruta. Ver aviso obrigatório no relatório (03-report-ab.mjs).
 *
 * ESTE ARQUIVO NÃO FAZ PARTE DO APP (fora de src/) e não é referenciado por
 * nenhum código de produção. Só é carregado pelo harness Playwright em
 * scripts/ab-shape/02b-embed-perturbed.mjs.
 */

async function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return await new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => rej(new Error("Falha ao ler imagem"));
    img.src = dataUrl;
  });
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  const d = max - min;
  if (d !== 0) {
    s = d / (1 - Math.abs(2 * l - 1) || 1);
    switch (max) {
      case r:
        h = ((g - b) / d) % 6;
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      default:
        h = (r - g) / d + 4;
        break;
    }
    h *= 60;
    if (h < 0) h += 360;
  }
  return [h, s, l];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

const clamp255 = (v: number) => Math.max(0, Math.min(255, v));

const SATURATION_FACTOR = 0.15; // passo 1 — ~15% da saturação original
const HIGHLIGHT_PERCENTILE = 0.85; // passo 2 — P85 da luminância
const GRAY_MIX = 0.3; // passo 3 — 30% de cinza médio (resultado = 70% img + 30% cinza)

export async function degradeColorContrastForTest(dataUrl: string): Promise<string> {
  const img = await loadImage(dataUrl);
  // Canvas com EXATAMENTE as dimensões da imagem de origem — nenhum resize.
  const w = img.naturalWidth;
  const h = img.naturalHeight;

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return dataUrl;
  // Desenho 1:1 em (0,0), sem escala, sem crop, sem rotação, sem flip.
  ctx.drawImage(img, 0, 0, w, h, 0, 0, w, h);

  const imageData = ctx.getImageData(0, 0, w, h);
  const px = imageData.data;
  const n = w * h;

  // Passo 1 — dessaturação HSL (mantém H e L, reduz S para 15% do original).
  // Operação por pixel, in-place: não move, corta nem redimensiona nada.
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    const [hh, s, l] = rgbToHsl(px[o], px[o + 1], px[o + 2]);
    const [r, g, b] = hslToRgb(hh, s * SATURATION_FACTOR, l);
    px[o] = clamp255(r);
    px[o + 1] = clamp255(g);
    px[o + 2] = clamp255(b);
  }

  // Passo 2 — achatamento do brilho: P85 da luminância da imagem já
  // dessaturada (passo 1); acima do P85, rescala uniforme do RGB até o P85
  // (preserva a cor relativa do pixel — só reduz brilho, não desenha nada).
  const lum = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    lum[i] = 0.299 * px[o] + 0.587 * px[o + 1] + 0.114 * px[o + 2];
  }
  const sortedLum = Float32Array.from(lum).sort();
  const p85 = sortedLum[Math.min(n - 1, Math.floor(n * HIGHLIGHT_PERCENTILE))];
  for (let i = 0; i < n; i++) {
    if (lum[i] > p85 && lum[i] > 0) {
      const o = i * 4;
      const scale = p85 / lum[i];
      px[o] = clamp255(px[o] * scale);
      px[o + 1] = clamp255(px[o + 1] * scale);
      px[o + 2] = clamp255(px[o + 2] * scale);
    }
  }

  // Passo 3 — redução de contraste: 70% imagem + 30% cinza médio (128).
  // Também por pixel, in-place — última etapa, sem geometria envolvida.
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    px[o] = clamp255(px[o] * (1 - GRAY_MIX) + 128 * GRAY_MIX);
    px[o + 1] = clamp255(px[o + 1] * (1 - GRAY_MIX) + 128 * GRAY_MIX);
    px[o + 2] = clamp255(px[o + 2] * (1 - GRAY_MIX) + 128 * GRAY_MIX);
  }

  ctx.putImageData(imageData, 0, 0);
  // Mesma dimensão de saída da entrada — nenhum recorte/enquadramento novo.
  return canvas.toDataURL("image/jpeg", 0.92);
}

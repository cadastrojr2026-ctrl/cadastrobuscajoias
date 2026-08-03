/**
 * Normalização de imagem para busca visual por FORMATO.
 *
 * A foto capturada pela câmera costuma ser de peça bruta (sem banho), enquanto o
 * catálogo tem peças folheadas. Para o embedding comparar geometria e não
 * acabamento, a imagem da consulta passa por:
 *  1. redução para um lado máximo controlado;
 *  2. escala de cinza (remove cor da liga/pedra e do banho);
 *  3. correção de iluminação (divisão pelo fundo suavizado) — mata sombra,
 *     brilho especular e reflexo;
 *  4. recorte automático no contorno da peça (remove fundo/mesa);
 *  5. equalização de contraste + fundo neutro quadrado, centralizado.
 *
 * Puramente client-side (canvas). Não altera a UI nem o banco.
 */

const MAX_SIDE = 768;
const OUT_SIDE = 640;

async function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return await new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => rej(new Error("Falha ao ler imagem"));
    img.src = dataUrl;
  });
}

/** Média em janela quadrada via imagem integral (box blur rápido). */
function boxBlur(src: Float32Array, w: number, h: number, radius: number): Float32Array {
  const integral = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let rowSum = 0;
    for (let x = 0; x < w; x++) {
      rowSum += src[y * w + x];
      integral[(y + 1) * (w + 1) + (x + 1)] = integral[y * (w + 1) + (x + 1)] + rowSum;
    }
  }
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - radius);
    const y1 = Math.min(h - 1, y + radius);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - radius);
      const x1 = Math.min(w - 1, x + radius);
      const area = (y1 - y0 + 1) * (x1 - x0 + 1);
      const sum =
        integral[(y1 + 1) * (w + 1) + (x1 + 1)] -
        integral[y0 * (w + 1) + (x1 + 1)] -
        integral[(y1 + 1) * (w + 1) + x0] +
        integral[y0 * (w + 1) + x0];
      out[y * w + x] = sum / area;
    }
  }
  return out;
}

export async function normalizeForShapeSearch(dataUrl: string): Promise<string> {
  try {
    const img = await loadImage(dataUrl);
    const scale = Math.min(1, MAX_SIDE / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));

    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    if (!ctx) return dataUrl;
    ctx.drawImage(img, 0, 0, w, h);
    const px = ctx.getImageData(0, 0, w, h).data;

    // 1) luminância
    const lum = new Float32Array(w * h);
    for (let i = 0, p = 0; i < lum.length; i++, p += 4) {
      lum[i] = 0.299 * px[p] + 0.587 * px[p + 1] + 0.114 * px[p + 2];
    }

    // 2) correção de iluminação: razão com o fundo suavizado
    const radius = Math.max(8, Math.round(Math.max(w, h) * 0.12));
    const bg = boxBlur(lum, w, h, radius);
    const flat = new Float32Array(w * h);
    for (let i = 0; i < flat.length; i++) {
      flat[i] = Math.max(0, Math.min(255, (lum[i] / Math.max(1, bg[i])) * 128));
    }

    // 3) contraste local -> gradiente (contorno) para achar a peça
    const grad = new Float32Array(w * h);
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        const gx = flat[i + 1] - flat[i - 1];
        const gy = flat[i + w] - flat[i - w];
        grad[i] = Math.abs(gx) + Math.abs(gy);
      }
    }
    let gMax = 0;
    for (let i = 0; i < grad.length; i++) if (grad[i] > gMax) gMax = grad[i];
    const gThr = gMax * 0.18;

    // 4) bounding box do contorno
    let minX = w, minY = h, maxX = 0, maxY = 0, hits = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (grad[y * w + x] >= gThr) {
          hits++;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (hits < 40 || maxX <= minX || maxY <= minY) {
      minX = 0; minY = 0; maxX = w - 1; maxY = h - 1;
    }
    // margem de 6%
    const pad = Math.round(Math.max(maxX - minX, maxY - minY) * 0.06);
    minX = Math.max(0, minX - pad);
    minY = Math.max(0, minY - pad);
    maxX = Math.min(w - 1, maxX + pad);
    maxY = Math.min(h - 1, maxY + pad);

    // 5) equalização por alongamento de percentis (2%–98%) na região recortada
    const vals: number[] = [];
    for (let y = minY; y <= maxY; y += 2) {
      for (let x = minX; x <= maxX; x += 2) vals.push(flat[y * w + x]);
    }
    vals.sort((a, b) => a - b);
    const lo = vals[Math.floor(vals.length * 0.02)] ?? 0;
    const hi = vals[Math.floor(vals.length * 0.98)] ?? 255;
    const span = Math.max(1, hi - lo);

    // 6) escreve em canvas quadrado com fundo neutro
    const cropW = maxX - minX + 1;
    const cropH = maxY - minY + 1;
    const tmp = document.createElement("canvas");
    tmp.width = cropW;
    tmp.height = cropH;
    const tctx = tmp.getContext("2d");
    if (!tctx) return dataUrl;
    const outImg = tctx.createImageData(cropW, cropH);
    for (let y = 0; y < cropH; y++) {
      for (let x = 0; x < cropW; x++) {
        const v = Math.max(0, Math.min(255, ((flat[(y + minY) * w + (x + minX)] - lo) / span) * 255));
        const o = (y * cropW + x) * 4;
        outImg.data[o] = v;
        outImg.data[o + 1] = v;
        outImg.data[o + 2] = v;
        outImg.data[o + 3] = 255;
      }
    }
    tctx.putImageData(outImg, 0, 0);

    const out = document.createElement("canvas");
    out.width = OUT_SIDE;
    out.height = OUT_SIDE;
    const octx = out.getContext("2d");
    if (!octx) return dataUrl;
    octx.fillStyle = "#808080";
    octx.fillRect(0, 0, OUT_SIDE, OUT_SIDE);
    const fit = (OUT_SIDE * 0.92) / Math.max(cropW, cropH);
    const dw = Math.round(cropW * fit);
    const dh = Math.round(cropH * fit);
    octx.imageSmoothingQuality = "high";
    octx.drawImage(tmp, (OUT_SIDE - dw) / 2, (OUT_SIDE - dh) / 2, dw, dh);

    return out.toDataURL("image/jpeg", 0.92);
  } catch {
    return dataUrl;
  }
}

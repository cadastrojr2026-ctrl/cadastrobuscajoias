// Client-side dominant-color extraction and comparison, used to re-rank
// visual search results so that stone color matters, not just shape.

export type Lab = { L: number; a: number; b: number };
export type ColorSig = {
  dominant: Lab;      // dominant chromatic (non-metal) color
  chromaMass: number; // 0..1 how much of the piece is a colored stone
};

function rgbToLab(r: number, g: number, b: number): Lab {
  // sRGB -> linear
  const srgb = [r, g, b].map((v) => {
    const x = v / 255;
    return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  });
  // linear RGB -> XYZ (D65)
  const X = srgb[0] * 0.4124564 + srgb[1] * 0.3575761 + srgb[2] * 0.1804375;
  const Y = srgb[0] * 0.2126729 + srgb[1] * 0.7151522 + srgb[2] * 0.072175;
  const Z = srgb[0] * 0.0193339 + srgb[1] * 0.119192 + srgb[2] * 0.9503041;
  // Normalize by D65 white
  const xn = X / 0.95047;
  const yn = Y / 1.0;
  const zn = Z / 1.08883;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(xn), fy = f(yn), fz = f(zn);
  return { L: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
}

function chroma(lab: Lab): number {
  return Math.sqrt(lab.a * lab.a + lab.b * lab.b);
}

/**
 * Extract dominant chromatic color signature from an image URL.
 * - Ignores near-white / near-black / near-grey (metal, background) pixels.
 * - Averages remaining colored pixels in Lab space.
 */
export async function extractColorSig(url: string, size = 48): Promise<ColorSig | null> {
  try {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.decoding = "async";
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("img load"));
      img.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, size, size);
    const { data } = ctx.getImageData(0, 0, size, size);

    let sumA = 0, sumB = 0, sumL = 0, count = 0;
    const total = size * size;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
      if (a < 200) continue;
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const sat = max === 0 ? 0 : (max - min) / max;
      // filter out metal (bright + low sat), background (very bright), shadow (very dark)
      if (max > 240 && sat < 0.15) continue;
      if (max < 25) continue;
      if (sat < 0.18) continue;
      const lab = rgbToLab(r, g, b);
      // Weight strongly saturated pixels more
      const w = Math.min(1, chroma(lab) / 40);
      sumL += lab.L * w;
      sumA += lab.a * w;
      sumB += lab.b * w;
      count += w;
    }
    if (count < 3) return null;
    const dominant: Lab = { L: sumL / count, a: sumA / count, b: sumB / count };
    return { dominant, chromaMass: Math.min(1, count / (total * 0.15)) };
  } catch {
    return null;
  }
}

/** Delta-E CIE76 between two Lab colors. Smaller = closer. */
export function deltaE(a: Lab, b: Lab): number {
  const dL = a.L - b.L;
  const da = a.a - b.a;
  const db = a.b - b.b;
  return Math.sqrt(dL * dL + da * da + db * db);
}

/**
 * Combine embedding similarity (0..1) with color similarity.
 * When query has no chromatic stone, color influence is small.
 */
export function combinedScore(embSim: number, query: ColorSig | null, cand: ColorSig | null): number {
  if (!query || query.chromaMass < 0.05) return embSim;
  if (!cand) return embSim * 0.9;
  const d = deltaE(query.dominant, cand.dominant);
  // Normalize: dE 0 => 1.0, dE 40+ => 0.0
  const colorSim = Math.max(0, 1 - d / 40);
  // Weight scales with how "colored" the query stone is
  const w = 0.55 * Math.min(1, query.chromaMass * 3);
  return embSim * (1 - w) + colorSim * w;
}

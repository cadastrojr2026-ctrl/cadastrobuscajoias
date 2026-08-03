import { createClient } from "@supabase/supabase-js";
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const LAK = process.env.LOVABLE_API_KEY;

const SHAPE_HINT =
  "Jewelry piece identification by GEOMETRY ONLY. The query may be an unplated raw casting (brass/silver-colored, matte) while the catalog item is the same model finished with gold plating. Match strictly on outline, silhouette, contour, proportions, structure, number and arrangement of elements, stone settings shape and layout. Completely ignore color, hue, metal tone, plating, polish, gloss, reflections, specular highlights, shadows, background and lighting.";

const CANDIDATES = {
  ping: "Jewelry pingente piece. Focus on shape and silhouette. Ignore stone color.",
  plain: "Jewelry piece. Focus on shape and silhouette. Ignore stone color.",
  anel: "Jewelry anel piece. Focus on shape and silhouette. Ignore stone color.",
  pendant: "Jewelry pendant piece. Focus on shape and silhouette. Ignore stone color.",
  pingentes: "Jewelry pingentes piece. Focus on shape and silhouette. Ignore stone color.",
  shape: SHAPE_HINT,
  empty: "",
};

function parse(v) { return typeof v === "string" ? JSON.parse(v) : v; }
function cos(a, b) { let d = 0, na = 0, nb = 0; for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; } return d / Math.sqrt(na * nb); }

async function embed(dataUrl, hint) {
  const content = hint ? [{ type: "text", text: hint }, { type: "image_url", image_url: { url: dataUrl } }] : [{ type: "image_url", image_url: { url: dataUrl } }];
  const r = await fetch("https://ai.gateway.lovable.dev/v1/embeddings", {
    method: "POST",
    headers: { Authorization: `Bearer ${LAK}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "google/gemini-embedding-2", input: [{ content }] }),
  });
  if (!r.ok) throw new Error(`emb ${r.status}: ${(await r.text()).slice(0, 150)}`);
  return (await r.json()).data[0].embedding;
}

// referência: cluster de julho (pingentes que funcionam bem)
const { data: july } = await supabase.from("pieces").select("code, embedding").eq("category", "pingente").lt("created_at", "2026-07-18").limit(60);
const julyEmb = july.map((r) => parse(r.embedding));

// imagem de teste: uma peça de julho -> reembedar e ver qual hint reproduz o cluster
const test = july[0];
const { data: file } = await supabase.storage.from("pieces").download((await supabase.from("pieces").select("image_path").eq("code", test.code).single()).data.image_path);
const buf = Buffer.from(await file.arrayBuffer());
const dataUrl = `data:image/jpeg;base64,${buf.toString("base64")}`;
const original = parse(test.embedding);

for (const [k, hint] of Object.entries(CANDIDATES)) {
  try {
    const e = await embed(dataUrl, hint);
    const self = cos(e, original);
    const avg = julyEmb.reduce((s, v) => s + cos(e, v), 0) / julyEmb.length;
    console.log(k.padEnd(10), "self=", self.toFixed(4), "avgJuly=", avg.toFixed(4));
  } catch (err) { console.log(k, "ERR", err.message); }
}

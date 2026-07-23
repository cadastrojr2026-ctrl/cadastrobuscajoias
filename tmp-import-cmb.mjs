import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";

const SUPA = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const LKEY = process.env.LOVABLE_API_KEY;
const CATEGORY = "cmb";

async function embed(dataUrl) {
  const r = await fetch("https://ai.gateway.lovable.dev/v1/embeddings", {
    method: "POST",
    headers: { Authorization: `Bearer ${LKEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "google/gemini-embedding-2",
      input: [{ content: [
        { type: "text", text: "Jewelry product photo. Focus on shape, silhouette, setting and overall design. Ignore stone or gem color." },
        { type: "image_url", image_url: { url: dataUrl } },
      ] }],
    }),
  });
  if (!r.ok) throw new Error(`emb ${r.status}: ${(await r.text()).slice(0,200)}`);
  const j = await r.json();
  return j.data[0].embedding;
}

function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (/\.(jpe?g|png|webp)$/i.test(e.name)) out.push(p);
  }
  return out;
}

const files = walk("/tmp/cmb");
console.log("files:", files.length);

let ok = 0, fail = 0;
const CONC = 6;
let idx = 0;
async function worker() {
  while (idx < files.length) {
    const i = idx++;
    const f = files[i];
    const code = path.basename(f).replace(/\.[^.]+$/, "").toUpperCase();
    try {
      const buf = fs.readFileSync(f);
      const ext = path.extname(f).toLowerCase().replace(".", "") || "jpg";
      const mime = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
      const storagePath = `${code}.${ext === "jpeg" ? "jpg" : ext}`;
      const { error: upErr } = await SUPA.storage.from("pieces").upload(storagePath, buf, { contentType: mime, upsert: true });
      if (upErr) throw upErr;
      const dataUrl = `data:${mime};base64,${buf.toString("base64")}`;
      const emb = await embed(dataUrl);
      const { error: insErr } = await SUPA.from("pieces").upsert({
        code, category: CATEGORY, image_path: storagePath, embedding: emb,
      }, { onConflict: "code" });
      if (insErr) throw insErr;
      ok++;
      if (ok % 25 === 0) console.log(`ok=${ok} fail=${fail}/${files.length}`);
    } catch (e) {
      fail++;
      console.error(code, e.message?.slice(0, 200));
    }
  }
}
await Promise.all(Array.from({ length: CONC }, worker));
console.log(`DONE ok=${ok} fail=${fail}`);

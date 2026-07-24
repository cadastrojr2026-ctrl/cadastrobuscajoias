import { createClient } from "@supabase/supabase-js";
import { readFile, readdir } from "node:fs/promises";
import { join, extname, basename } from "node:path";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SRK = process.env.SUPABASE_SERVICE_ROLE_KEY;
const LAK = process.env.LOVABLE_API_KEY;
const DIR = "/tmp/acess2";
const CATEGORY = "acessorio";
const CONCURRENCY = 6;

const supabase = createClient(SUPABASE_URL, SRK, { auth: { persistSession: false } });

async function walk(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...await walk(p));
    else if (/\.(jpe?g|png|webp)$/i.test(e.name)) out.push(p);
  }
  return out;
}

async function embed(dataUrl) {
  const r = await fetch("https://ai.gateway.lovable.dev/v1/embeddings", {
    method: "POST",
    headers: { Authorization: `Bearer ${LAK}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "google/gemini-embedding-2",
      input: [{ content: [
        { type: "text", text: `Jewelry ${CATEGORY} piece. Focus on shape and silhouette. Ignore stone color.` },
        { type: "image_url", image_url: { url: dataUrl } },
      ]}],
    }),
  });
  if (!r.ok) throw new Error(`emb ${r.status}: ${(await r.text()).slice(0,200)}`);
  const j = await r.json();
  return j.data[0].embedding;
}

async function processFile(file) {
  const name = basename(file);
  const ext = extname(name).toLowerCase().replace(".", "");
  const code = basename(name, extname(name)).trim().toUpperCase().replace(/\s+/g, "_");
  const mime = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
  const buf = await readFile(file);
  const path = `${code}.${ext === "jpeg" ? "jpg" : ext}`;

  const { error: upErr } = await supabase.storage.from("pieces").upload(path, buf, { contentType: mime, upsert: true });
  if (upErr) throw new Error(`upload ${code}: ${upErr.message}`);

  const dataUrl = `data:${mime};base64,${buf.toString("base64")}`;
  const emb = await embed(dataUrl);

  const { error: insErr } = await supabase.from("pieces").upsert({
    code, name: null, category: CATEGORY, image_path: path, embedding: emb,
  }, { onConflict: "code" });
  if (insErr) throw new Error(`insert ${code}: ${insErr.message}`);
  return code;
}

const files = await walk(DIR);
// Skip Thumbs.db-like non-images already filtered; also dedupe by basename
const seen = new Set();
const uniq = files.filter(f => { const b = basename(f).toUpperCase(); if (seen.has(b)) return false; seen.add(b); return true; });
console.log(`Found ${files.length} files, ${uniq.length} unique`);
let ok = 0, fail = 0;
let idx = 0;
async function worker() {
  while (idx < uniq.length) {
    const i = idx++;
    try { await processFile(uniq[i]); ok++; }
    catch (e) { fail++; console.error(`FAIL ${uniq[i]}: ${e.message}`); }
    if ((ok+fail) % 25 === 0) console.log(`progress ${ok+fail}/${uniq.length} ok=${ok} fail=${fail}`);
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));
console.log(`DONE ok=${ok} fail=${fail}`);

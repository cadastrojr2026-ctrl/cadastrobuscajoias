import { createClient } from "@supabase/supabase-js";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const LOV = process.env.LOVABLE_API_KEY;

async function embed(dataUrl, hint) {
  const r = await fetch("https://ai.gateway.lovable.dev/v1/embeddings", {
    method: "POST",
    headers: { Authorization: `Bearer ${LOV}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "google/gemini-embedding-2",
      input: [{ content: [{ type: "text", text: hint }, { type: "image_url", image_url: { url: dataUrl } }] }],
    }),
  });
  if (!r.ok) throw new Error(`emb ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const j = await r.json();
  return j.data[0].embedding;
}

async function walk(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(p)));
    else if (/\.(jpe?g|png|webp)$/i.test(e.name)) out.push(p);
  }
  return out;
}

const files = await walk("/tmp/ping");
console.log("files:", files.length);

let done = 0, err = 0;
const CONCURRENCY = 8;

async function processOne(file) {
  try {
    const name = path.basename(file);
    const base = name.replace(/\.[^.]+$/, "");
    const m = base.match(/([A-Za-z]+\d+)/);
    const code = (m ? m[1] : base).toUpperCase();
    const ext = name.toLowerCase().endsWith(".png") ? "png" : name.toLowerCase().endsWith(".webp") ? "webp" : "jpg";
    const mime = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
    const buf = await readFile(file);
    const dataUrl = `data:${mime};base64,${buf.toString("base64")}`;
    const storagePath = `${code}.${ext}`;

    const { error: upErr } = await supabase.storage.from("pieces").upload(storagePath, buf, { contentType: mime, upsert: true });
    if (upErr) throw upErr;

    const emb = await embed(dataUrl, `Jewelry pendant, code ${code}`);
    const { error: insErr } = await supabase.from("pieces").upsert(
      { code, category: "pingente", image_path: storagePath, embedding: emb },
      { onConflict: "code" },
    );
    if (insErr) throw insErr;
    done++;
    if (done % 25 === 0) console.log(`ok ${done}/${files.length} (err ${err})`);
  } catch (e) {
    err++;
    console.error("ERR", file, e.message);
  }
}

const queue = [...files];
await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    while (queue.length) await processOne(queue.shift());
  }),
);
console.log(`done=${done} err=${err}`);

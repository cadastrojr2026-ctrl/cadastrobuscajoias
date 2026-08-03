import { createClient } from "@supabase/supabase-js";
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const LAK = process.env.LOVABLE_API_KEY;
const CATEGORY = "pingente";
const HINT = `Jewelry ${CATEGORY} piece. Focus on shape and silhouette. Ignore stone color.`;

async function embed(dataUrl) {
  const r = await fetch("https://ai.gateway.lovable.dev/v1/embeddings", {
    method: "POST",
    headers: { Authorization: `Bearer ${LAK}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "google/gemini-embedding-2",
      input: [{ content: [{ type: "text", text: HINT }, { type: "image_url", image_url: { url: dataUrl } }] }],
    }),
  });
  if (!r.ok) throw new Error(`emb ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return (await r.json()).data[0].embedding;
}

const { data: rows, error } = await supabase
  .from("pieces")
  .select("id, code, image_path")
  .eq("category", CATEGORY)
  .lt("created_at", "2026-08-02T00:00:00Z");
if (error) throw error;
console.log(`Reindex ${rows.length} pingentes`);

let ok = 0, fail = 0, idx = 0;
async function worker() {
  while (idx < rows.length) {
    const row = rows[idx++];
    try {
      const dl = await supabase.storage.from("pieces").download(row.image_path);
      if (dl.error || !dl.data) throw new Error(dl.error?.message ?? "no image");
      const buf = Buffer.from(await dl.data.arrayBuffer());
      const ext = row.image_path.split(".").pop().toLowerCase();
      const mime = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
      const emb = await embed(`data:${mime};base64,${buf.toString("base64")}`);
      const { error: upErr } = await supabase.from("pieces").update({ embedding: emb }).eq("id", row.id);
      if (upErr) throw new Error(upErr.message);
      ok++;
    } catch (e) {
      fail++;
      console.error(`FAIL ${row.code}: ${e.message}`);
    }
    if ((ok + fail) % 50 === 0) console.log(`${ok + fail}/${rows.length} ok=${ok} fail=${fail}`);
  }
}
await Promise.all(Array.from({ length: 8 }, worker));
console.log(`DONE ok=${ok} fail=${fail}`);

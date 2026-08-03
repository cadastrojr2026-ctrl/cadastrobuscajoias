const GATEWAY = "https://ai.gateway.lovable.dev/v1/embeddings";

export const SHAPE_HINT =
  "Jewelry piece identification by GEOMETRY ONLY. The query may be an unplated raw casting (brass/silver-colored, matte) while the catalog item is the same model finished with gold plating. Match strictly on outline, silhouette, contour, proportions, structure, number and arrangement of elements, stone settings shape and layout. Completely ignore color, hue, metal tone, plating, polish, gloss, reflections, specular highlights, shadows, background and lighting.";

export async function embedImage(dataUrl: string, hint: string): Promise<number[]> {
  const key = process.env.LOVABLE_API_KEY;
  if (!key) throw new Error("Missing LOVABLE_API_KEY");
  const r = await fetch(GATEWAY, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "google/gemini-embedding-2",
      input: [
        {
          content: [
            { type: "text", text: hint },
            { type: "image_url", image_url: { url: dataUrl } },
          ],
        },
      ],
    }),
  });
  if (!r.ok) {
    const txt = await r.text();
    throw new Error(`Embedding failed [${r.status}]: ${txt.slice(0, 300)}`);
  }
  const json = (await r.json()) as { data: Array<{ embedding: number[] }> };
  return json.data[0].embedding;
}

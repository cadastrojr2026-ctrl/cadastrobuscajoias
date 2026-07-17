import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const GATEWAY = "https://ai.gateway.lovable.dev/v1/embeddings";

async function embedImage(dataUrl: string, hint: string): Promise<number[]> {
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

// PUBLIC-ISH: authenticated user can search
export const searchByImage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ imageDataUrl: z.string().min(20), limit: z.number().min(1).max(48).default(24) }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const emb = await embedImage(data.imageDataUrl, "Jewelry ring product photo");
    const { data: matches, error } = await context.supabase.rpc("match_pieces", {
      query_embedding: emb as unknown as string,
      match_count: data.limit,
    });
    if (error) throw new Error(error.message);
    return (matches ?? []) as Array<{
      id: string;
      code: string;
      name: string | null;
      image_path: string;
      similarity: number;
    }>;
  });

export const searchByText = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ q: z.string().min(1).max(100), limit: z.number().min(1).max(60).default(30) }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const q = data.q.trim();
    const { data: rows, error } = await context.supabase
      .from("pieces")
      .select("id, code, name, image_path")
      .or(`code.ilike.%${q}%,name.ilike.%${q}%`)
      .limit(data.limit);
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const getMyRole = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    const roles = (data ?? []).map((r) => r.role);
    return { roles, isAdmin: roles.includes("admin") };
  });

export const listAllPieces = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("pieces")
      .select("id, code, name, image_path, created_at")
      .order("code", { ascending: true });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const addPiece = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        code: z.string().min(1).max(50),
        name: z.string().max(120).optional(),
        category: z.string().max(40).optional(),
        imageDataUrl: z.string().min(20),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    // Verify admin
    const { data: role } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!role) throw new Error("Apenas administradores podem cadastrar peças.");

    const code = data.code.trim().toUpperCase();
    const match = data.imageDataUrl.match(/^data:(image\/[a-z]+);base64,(.+)$/);
    if (!match) throw new Error("Formato de imagem inválido.");
    const mime = match[1];
    const ext = mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg";
    const bytes = Uint8Array.from(atob(match[2]), (c) => c.charCodeAt(0));

    const path = `${code}.${ext}`;
    const { error: upErr } = await context.supabase.storage
      .from("pieces")
      .upload(path, bytes, { contentType: mime, upsert: true });
    if (upErr) throw new Error(`Upload: ${upErr.message}`);

    const emb = await embedImage(data.imageDataUrl, `Jewelry ${data.category ?? "piece"}, code ${code}`);

    const { error: insErr } = await context.supabase.from("pieces").upsert(
      {
        code,
        name: data.name ?? null,
        category: data.category ?? "anel",
        image_path: path,
        embedding: emb as unknown as string,
        created_by: context.userId,
      },
      { onConflict: "code" },
    );
    if (insErr) throw new Error(insErr.message);
    return { ok: true, code };
  });

export const deletePiece = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { data: role } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!role) throw new Error("Apenas administradores.");
    const { data: piece } = await context.supabase
      .from("pieces")
      .select("image_path")
      .eq("id", data.id)
      .maybeSingle();
    if (piece?.image_path) {
      await context.supabase.storage.from("pieces").remove([piece.image_path]);
    }
    const { error } = await context.supabase.from("pieces").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

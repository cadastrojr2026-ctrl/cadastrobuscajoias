import { supabase } from "@/integrations/supabase/client";

/** Generate signed URLs for a batch of storage paths (private bucket). */
export async function getSignedImageUrls(paths: string[]): Promise<Record<string, string>> {
  if (paths.length === 0) return {};
  const { data, error } = await supabase.storage
    .from("pieces")
    .createSignedUrls(paths, 60 * 60); // 1 hour
  if (error) throw error;
  const out: Record<string, string> = {};
  for (const item of data ?? []) {
    if (item.path && item.signedUrl) out[item.path] = item.signedUrl;
  }
  return out;
}

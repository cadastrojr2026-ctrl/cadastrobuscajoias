ALTER TABLE public.pieces ADD COLUMN IF NOT EXISTS embedding_v2 vector(384);

CREATE INDEX IF NOT EXISTS pieces_embedding_v2_idx
  ON public.pieces USING hnsw (embedding_v2 vector_cosine_ops);

CREATE OR REPLACE FUNCTION public.match_pieces_v2(
  query_embedding vector,
  match_count integer DEFAULT 36,
  filter_category text DEFAULT NULL::text
)
RETURNS TABLE(id uuid, code text, name text, image_path text, category text, product_code text, similarity double precision)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  select p.id, p.code, p.name, p.image_path, p.category,
         coalesce(p.product_code, p.code) as product_code,
         1 - (p.embedding_v2 <=> query_embedding) as similarity
  from public.pieces p
  where p.embedding_v2 is not null
    and (filter_category is null or p.category = filter_category)
  order by p.embedding_v2 <=> query_embedding
  limit match_count;
$function$;

REVOKE ALL ON FUNCTION public.match_pieces_v2(vector, integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.match_pieces_v2(vector, integer, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.match_pieces_v2(vector, integer, text) TO service_role;

CREATE OR REPLACE FUNCTION public.index_v2_stats()
RETURNS TABLE(total bigint, indexed bigint)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  select count(*)::bigint, count(embedding_v2)::bigint from public.pieces;
$function$;

REVOKE ALL ON FUNCTION public.index_v2_stats() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.index_v2_stats() TO authenticated;
GRANT EXECUTE ON FUNCTION public.index_v2_stats() TO service_role;
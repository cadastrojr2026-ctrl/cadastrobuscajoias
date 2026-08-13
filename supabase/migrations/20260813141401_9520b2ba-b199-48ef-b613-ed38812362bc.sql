DROP FUNCTION IF EXISTS public.match_pieces_v2(vector, integer, text);

CREATE OR REPLACE FUNCTION public.match_pieces_v2(
  query_embedding vector,
  match_count integer DEFAULT 36,
  filter_category text DEFAULT NULL,
  ef_search integer DEFAULT 100
)
RETURNS TABLE(
  id uuid,
  code text,
  name text,
  image_path text,
  category text,
  product_code text,
  similarity double precision
)
LANGUAGE plpgsql
VOLATILE
SET search_path TO 'public'
AS $function$
declare
  v_ef int := least(greatest(coalesce(ef_search, 100), 40), 1000);
  v_count int := least(greatest(coalesce(match_count, 36), 1), 500);
begin
  perform set_config('hnsw.ef_search', v_ef::text, true);
  perform set_config('hnsw.iterative_scan', 'relaxed_order', true);
  perform set_config('hnsw.max_scan_tuples', '40000', true);

  return query
  select p.id, p.code, p.name, p.image_path, p.category,
         coalesce(p.product_code, p.code) as product_code,
         1 - (p.embedding_v2 <=> query_embedding) as similarity
  from public.pieces p
  where p.embedding_v2 is not null
    and (filter_category is null or p.category = filter_category)
  order by p.embedding_v2 <=> query_embedding
  limit v_count;
end;
$function$;

REVOKE ALL ON FUNCTION public.match_pieces_v2(vector, integer, text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.match_pieces_v2(vector, integer, text, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.match_pieces_v2(vector, integer, text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.match_pieces_v2(vector, integer, text, integer) TO service_role;
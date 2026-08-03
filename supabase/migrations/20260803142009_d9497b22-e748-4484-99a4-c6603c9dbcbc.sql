ALTER TABLE public.pieces ADD COLUMN IF NOT EXISTS product_code text;
CREATE INDEX IF NOT EXISTS pieces_product_code_idx ON public.pieces ((coalesce(product_code, code)));

DROP FUNCTION IF EXISTS public.match_pieces(vector, integer, text);

CREATE FUNCTION public.match_pieces(query_embedding vector, match_count integer DEFAULT 24, filter_category text DEFAULT NULL::text)
 RETURNS TABLE(id uuid, code text, name text, image_path text, category text, product_code text, similarity double precision)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select p.id, p.code, p.name, p.image_path, p.category,
         coalesce(p.product_code, p.code) as product_code,
         1 - (p.embedding::halfvec(3072) <=> query_embedding::halfvec(3072)) as similarity
  from public.pieces p
  where p.embedding is not null
    and (filter_category is null or p.category = filter_category)
  order by p.embedding::halfvec(3072) <=> query_embedding::halfvec(3072)
  limit match_count;
$function$;

REVOKE EXECUTE ON FUNCTION public.match_pieces(vector, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.match_pieces(vector, integer, text) TO authenticated, service_role;
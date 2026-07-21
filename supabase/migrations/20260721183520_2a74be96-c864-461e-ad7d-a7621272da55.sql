CREATE OR REPLACE FUNCTION public.match_pieces(query_embedding vector, match_count integer DEFAULT 24)
 RETURNS TABLE(id uuid, code text, name text, image_path text, similarity double precision)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select p.id, p.code, p.name, p.image_path,
         1 - (p.embedding::halfvec(3072) <=> query_embedding::halfvec(3072)) as similarity
  from public.pieces p
  where p.embedding is not null
  order by p.embedding::halfvec(3072) <=> query_embedding::halfvec(3072)
  limit match_count;
$function$;

CREATE OR REPLACE FUNCTION public.match_pieces(query_embedding vector, match_count integer DEFAULT 24, filter_category text DEFAULT NULL::text)
 RETURNS TABLE(id uuid, code text, name text, image_path text, category text, similarity double precision)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select p.id, p.code, p.name, p.image_path, p.category,
         1 - (p.embedding::halfvec(3072) <=> query_embedding::halfvec(3072)) as similarity
  from public.pieces p
  where p.embedding is not null
    and (filter_category is null or p.category = filter_category)
  order by p.embedding::halfvec(3072) <=> query_embedding::halfvec(3072)
  limit match_count;
$function$;
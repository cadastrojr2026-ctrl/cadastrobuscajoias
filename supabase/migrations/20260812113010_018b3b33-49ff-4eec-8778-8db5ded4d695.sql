create or replace function public.save_vectors_v2(payload jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  if not (current_user in ('service_role', 'postgres', 'supabase_admin')
          or public.has_role(auth.uid(), 'admin'::app_role)) then
    raise exception 'apenas administradores';
  end if;

  with src as (
    select (elem->>'id')::uuid as id,
           (elem->>'vector')::vector(384) as vec
    from jsonb_array_elements(payload) as elem
  )
  update public.pieces p
     set embedding_v2 = src.vec,
         updated_at = now()
    from src
   where p.id = src.id;

  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function public.save_vectors_v2(jsonb) from public;
revoke execute on function public.save_vectors_v2(jsonb) from authenticated;
grant execute on function public.save_vectors_v2(jsonb) to service_role;
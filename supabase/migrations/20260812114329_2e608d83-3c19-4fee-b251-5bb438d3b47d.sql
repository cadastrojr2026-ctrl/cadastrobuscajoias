create or replace function public.save_vectors_v2(payload jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer := 0;
  elem jsonb;
begin
  if not (current_user in ('service_role', 'postgres', 'supabase_admin')
          or public.has_role(auth.uid(), 'admin'::app_role)) then
    raise exception 'apenas administradores';
  end if;

  for elem in select * from jsonb_array_elements(payload) loop
    update public.pieces
       set embedding_v2 = (elem->>'vector')::vector(384),
           updated_at = now()
     where id = (elem->>'id')::uuid;
    n := n + 1;
  end loop;

  return n;
end;
$$;

revoke all on function public.save_vectors_v2(jsonb) from public;
revoke execute on function public.save_vectors_v2(jsonb) from authenticated;
grant execute on function public.save_vectors_v2(jsonb) to service_role;
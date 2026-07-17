
create extension if not exists vector;

-- Roles
create type public.app_role as enum ('admin', 'user');

create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  role app_role not null,
  created_at timestamptz not null default now(),
  unique (user_id, role)
);

grant select on public.user_roles to authenticated;
grant all on public.user_roles to service_role;
alter table public.user_roles enable row level security;

create policy "Users can view their own roles"
  on public.user_roles for select to authenticated
  using (user_id = auth.uid());

create or replace function public.has_role(_user_id uuid, _role app_role)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles where user_id = _user_id and role = _role)
$$;

grant execute on function public.has_role(uuid, app_role) to authenticated, anon;

-- Auto-assign first user as admin, others as regular user
create or replace function public.handle_new_user_role()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_count int;
begin
  select count(*) into v_count from public.user_roles where role = 'admin';
  if v_count = 0 then
    insert into public.user_roles (user_id, role) values (new.id, 'admin');
  else
    insert into public.user_roles (user_id, role) values (new.id, 'user');
  end if;
  return new;
end;
$$;

create trigger on_auth_user_created_role
after insert on auth.users
for each row execute function public.handle_new_user_role();

-- Pieces catalog
create table public.pieces (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text,
  description text,
  category text default 'anel',
  image_path text not null,
  embedding vector(3072),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);

grant select on public.pieces to anon, authenticated;
grant insert, update, delete on public.pieces to authenticated;
grant all on public.pieces to service_role;

alter table public.pieces enable row level security;

create policy "Anyone can view pieces"
  on public.pieces for select
  using (true);

create policy "Admins can insert pieces"
  on public.pieces for insert to authenticated
  with check (public.has_role(auth.uid(), 'admin'));

create policy "Admins can update pieces"
  on public.pieces for update to authenticated
  using (public.has_role(auth.uid(), 'admin'));

create policy "Admins can delete pieces"
  on public.pieces for delete to authenticated
  using (public.has_role(auth.uid(), 'admin'));

create index pieces_code_idx on public.pieces (code);
create index pieces_embedding_idx on public.pieces using hnsw ((embedding::halfvec(3072)) halfvec_cosine_ops);

create or replace function public.update_updated_at_column()
returns trigger language plpgsql set search_path = public as $$
begin new.updated_at = now(); return new; end;
$$;

create trigger update_pieces_updated_at
before update on public.pieces
for each row execute function public.update_updated_at_column();

-- Similarity search
create or replace function public.match_pieces(
  query_embedding vector(3072),
  match_count int default 24
)
returns table (id uuid, code text, name text, image_path text, similarity float)
language sql stable as $$
  select p.id, p.code, p.name, p.image_path,
         1 - (p.embedding::halfvec(3072) <=> query_embedding::halfvec(3072)) as similarity
  from public.pieces p
  where p.embedding is not null
  order by p.embedding::halfvec(3072) <=> query_embedding::halfvec(3072)
  limit match_count;
$$;

grant execute on function public.match_pieces(vector, int) to anon, authenticated;

-- Storage policies for pieces bucket
create policy "Anyone can view piece images"
  on storage.objects for select
  using (bucket_id = 'pieces');

create policy "Admins can upload piece images"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'pieces' and public.has_role(auth.uid(), 'admin'));

create policy "Admins can update piece images"
  on storage.objects for update to authenticated
  using (bucket_id = 'pieces' and public.has_role(auth.uid(), 'admin'));

create policy "Admins can delete piece images"
  on storage.objects for delete to authenticated
  using (bucket_id = 'pieces' and public.has_role(auth.uid(), 'admin'));

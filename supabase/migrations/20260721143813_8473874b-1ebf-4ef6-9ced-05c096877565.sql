
-- Approval table
CREATE TABLE public.user_approvals (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  approved_at timestamptz,
  approved_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_approvals TO authenticated;
GRANT ALL ON public.user_approvals TO service_role;

ALTER TABLE public.user_approvals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own approval"
  ON public.user_approvals FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Admins view all approvals"
  ON public.user_approvals FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins update approvals"
  ON public.user_approvals FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins insert approvals"
  ON public.user_approvals FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER update_user_approvals_updated_at
  BEFORE UPDATE ON public.user_approvals
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Update signup handler: first user becomes approved admin; others go pending
CREATE OR REPLACE FUNCTION public.handle_new_user_role()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
declare
  v_count int;
  v_is_first boolean;
begin
  select count(*) into v_count from public.user_roles where role = 'admin';
  v_is_first := v_count = 0;

  if v_is_first then
    insert into public.user_roles (user_id, role) values (new.id, 'admin')
      on conflict do nothing;
    insert into public.user_approvals (user_id, email, status, approved_at)
      values (new.id, new.email, 'approved', now())
      on conflict (user_id) do nothing;
  else
    insert into public.user_roles (user_id, role) values (new.id, 'user')
      on conflict do nothing;
    insert into public.user_approvals (user_id, email, status)
      values (new.id, new.email, 'pending')
      on conflict (user_id) do nothing;
  end if;

  return new;
end;
$$;

-- Backfill: all existing users are approved (they already have access today)
INSERT INTO public.user_approvals (user_id, email, status, approved_at)
SELECT u.id, coalesce(u.email, ''), 'approved', now()
FROM auth.users u
WHERE NOT EXISTS (SELECT 1 FROM public.user_approvals a WHERE a.user_id = u.id)
ON CONFLICT (user_id) DO NOTHING;

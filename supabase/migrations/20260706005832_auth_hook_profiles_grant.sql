-- Fix: custom_access_token_hook always returned role MEMBER.
-- The hook runs as supabase_auth_admin (SECURITY INVOKER); profiles RLS
-- policies are TO authenticated only, so the role lookup returned no rows and
-- the hook fell back to coalesce(null, 'MEMBER') — admins never got ADMIN JWTs.
-- Per Supabase auth-hook docs: grant the auth admin read access + lock down
-- the hook function itself.

grant select on public.profiles to supabase_auth_admin;
grant execute on function public.custom_access_token_hook to supabase_auth_admin;
revoke execute on function public.custom_access_token_hook from authenticated, anon, public;

drop policy if exists profiles_auth_admin_read on public.profiles;
create policy profiles_auth_admin_read on public.profiles
  for select to supabase_auth_admin using (true);

-- Backfill: server-side checks read `user.app_metadata.role` via getUser(),
-- which returns raw_app_meta_data (the hook only rewrites JWT claims). Without
-- this, admin pages/routes fail closed for everyone.
update auth.users u
set raw_app_meta_data = coalesce(u.raw_app_meta_data, '{}'::jsonb)
  || jsonb_build_object('role', p.role)
from public.profiles p
where p.id = u.id;

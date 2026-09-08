-- W2 / F1 follow-up. The previous migration revoked EXECUTE from anon and
-- authenticated, which was not enough: Postgres grants EXECUTE to PUBLIC by
-- default on every function, and anon/authenticated inherit through PUBLIC.
-- The advisor still reported both lints afterwards.
--
-- Note the backlog's verify query is also wrong for the same reason -- it
-- filters `pg_get_userbyid(ac.grantee) in ('anon','authenticated')`, which
-- never matches the PUBLIC entry (grantee OID 0) and so reports a clean
-- zero rows while the grant is still live.

revoke execute on function public.resolve_game(uuid, integer, integer) from public;
revoke execute on function public.close_week(integer)                  from public;
revoke execute on function public.handle_new_user()                    from public;
revoke execute on function public.rls_auto_enable()                    from public;

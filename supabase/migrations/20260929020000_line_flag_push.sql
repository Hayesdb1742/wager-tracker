-- Push a line flag to the commissioners' phones the moment it is raised.
--
-- 20260928213000_pick_line_flags.sql records a flag; nothing told anyone. This adds the
-- delivery half: somewhere to keep a browser's Web Push subscription, and a trigger that
-- asks the app to send. The destination is the app's own Web Push (VAPID) -- no third-party
-- service, no new account, and the notification lands on the lock screen of a phone that has
-- wager-tracker added to its home screen.
--
-- The HTTP call reuses the two Vault secrets request_odds_sync() and request_results_sync()
-- already use, so there is nothing new to configure in the database:
--
--   select vault.create_secret('<CRON_SECRET from .env.local>', 'cron_secret');
--   select vault.create_secret('https://wager-tracker.vercel.app', 'app_url');

-- ------------------------------------------------------------------
-- 1. push_subscriptions -- one row per browser that opted in
-- ------------------------------------------------------------------
-- A Web Push subscription is a URL the browser vendor gave us plus two keys to encrypt the
-- payload with. It is per browser, not per person: the same admin on a phone and a laptop is
-- two rows, and both should ring.

create table public.push_subscriptions (
  endpoint     text primary key,
  member_id    uuid not null references public.profiles (id) on delete cascade,
  p256dh       text not null,
  auth         text not null,
  user_agent   text null,
  created_at   timestamptz not null default now(),
  last_sent_at timestamptz null,
  last_error   text null
);

comment on table public.push_subscriptions is
  'Web Push (VAPID) subscriptions for admin alerts. One row per browser, keyed by the endpoint the browser vendor issued. Written only by /api/admin/push/subscribe on the service-role client; a subscription the push service rejects as gone is deleted by the sender.';
comment on column public.push_subscriptions.endpoint is
  'The push service URL for this browser. Unique by nature, so it is the key -- re-subscribing the same browser updates in place rather than piling up rows.';
comment on column public.push_subscriptions.p256dh is
  'The subscription''s public key, for payload encryption.';
comment on column public.push_subscriptions.auth is
  'The subscription''s auth secret, for payload encryption.';
comment on column public.push_subscriptions.last_error is
  'Why the last send failed, when it did. A 404/410 means the browser dropped the subscription and the row is removed instead.';

create index push_subscriptions_member_idx on public.push_subscriptions (member_id);

alter table public.push_subscriptions enable row level security;

-- Read-only, and only for admins: the endpoint is a capability URL -- anyone holding it can
-- push to that browser -- so it is never handed to the client.
create policy "push_subscriptions_admin_read" on public.push_subscriptions
  for select using (
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'ADMIN'
  );

-- ------------------------------------------------------------------
-- 2. pick_line_flags.notified_at -- what has actually been sent
-- ------------------------------------------------------------------

alter table public.pick_line_flags
  add column notified_at timestamptz null;

comment on column public.pick_line_flags.notified_at is
  'When a push for this flag was successfully sent to at least one subscription. Null means nobody was told -- no subscriptions yet, or every send failed.';

-- The detail view carries it too, so the catch-up path ("everything raised that nobody was
-- told about") can be one query against the view the notifier already reads.
create or replace view public.pick_line_flags_detail
  with (security_invoker = true)
as
  select
    f.pick_id,
    f.status,
    f.verdict,
    f.deviation,
    pr.display_name                      as member,
    f.placed_at,
    g.sport,
    w.week_number,
    g.away_team || ' at ' || g.home_team as matchup,
    g.kickoff_time,
    f.bet_type,
    f.selection,
    f.pick_line,
    f.pick_odds,
    f.market_best_line,
    f.market_worst_line,
    f.books_seen,
    f.market_rows,
    f.tolerance,
    p.is_lotw,
    p.is_loty,
    p.points,
    ov.display_name                      as overridden_by,
    p.overridden_at,
    f.first_flagged_at,
    f.last_checked_at,
    rv.display_name                      as reviewed_by,
    f.reviewed_at,
    f.review_note,
    -- Appended rather than slotted in beside the other timestamps: CREATE OR REPLACE VIEW
    -- may only add columns at the end, and a drop-and-recreate is not worth tidier ordering.
    f.notified_at
  from public.pick_line_flags f
  join public.picks    p  on p.id  = f.pick_id
  join public.profiles pr on pr.id = f.member_id
  join public.games    g  on g.id  = f.game_id
  join public.weeks    w  on w.id  = f.week_id
  left join public.profiles ov on ov.id = p.overridden_by
  left join public.profiles rv on rv.id = f.reviewed_by;

comment on view public.pick_line_flags_detail is
  'pick_line_flags with the names an audit needs: who placed it, when, on what game, what they wrote, and what the books had. Admin-only through the underlying table''s policy.';

-- ------------------------------------------------------------------
-- 3. request_line_flag_push() -- ask the app to send
-- ------------------------------------------------------------------

create or replace function public.request_line_flag_push(p_pick_ids uuid[])
returns bigint
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_secret text;
  v_url    text;
begin
  if p_pick_ids is null or array_length(p_pick_ids, 1) is null then
    return null;
  end if;

  -- Nobody to tell: don't spend a request finding that out.
  if not exists (select 1 from public.push_subscriptions) then
    return null;
  end if;

  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'cron_secret';
  select decrypted_secret into v_url    from vault.decrypted_secrets where name = 'app_url';

  if v_secret is null or v_url is null then
    raise warning 'request_line_flag_push: vault secrets cron_secret and/or app_url are missing; not sending %', p_pick_ids;
    return null;
  end if;

  return net.http_post(
    url                  := rtrim(v_url, '/') || '/api/admin/line-flags/notify',
    body                 := jsonb_build_object('pick_ids', to_jsonb(p_pick_ids)),
    headers              := jsonb_build_object(
                              'Content-Type', 'application/json',
                              'Authorization', 'Bearer ' || v_secret),
    timeout_milliseconds := 30000);
end;
$$;

comment on function public.request_line_flag_push(uuid[]) is
  'POSTs the flagged pick ids to the app''s /api/admin/line-flags/notify (Bearer cron_secret from Vault), which sends the Web Push. Returns the pg_net request id, or null when it did nothing.';

revoke execute on function public.request_line_flag_push(uuid[]) from public, anon, authenticated;

-- ------------------------------------------------------------------
-- 4. The trigger -- new flags only, one request per statement
-- ------------------------------------------------------------------
-- INSERT and not UPDATE, deliberately. flag_pick_line() refreshes an existing flag through
-- ON CONFLICT DO UPDATE every time the market moves, and a phone buzzing on every odds poll
-- for a flag already seen is how someone turns notifications off for good. A flag is news
-- once.
--
-- Statement-level, so a sweep that raises twenty flags at once sends one request carrying
-- twenty ids rather than twenty requests -- recheck_pick_line_flags() at a new tolerance
-- would otherwise be a pager storm.
--
-- pg_net queues the request in this transaction, so a pick that rolls back sends nothing.

create or replace function public.pick_line_flags_push()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids uuid[];
begin
  begin
    select array_agg(i.pick_id) into v_ids from inserted i;
    perform public.request_line_flag_push(v_ids);
  exception when others then
    raise warning 'pick_line_flags_push: no notification sent: %', sqlerrm;
  end;
  return null;
end;
$$;

comment on function public.pick_line_flags_push() is
  'AFTER INSERT statement trigger on pick_line_flags: asks the app to push the newly raised flags. Never raises -- a notification failure must not roll back the flag, nor the pick that caused it.';

revoke execute on function public.pick_line_flags_push() from public, anon, authenticated;

create trigger pick_line_flags_push_after_insert
  after insert on public.pick_line_flags
  referencing new table as inserted
  for each statement execute function public.pick_line_flags_push();

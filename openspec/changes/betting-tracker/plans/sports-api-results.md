# Plan: Live games + scores + auto-resolution from sports APIs

> **Implementation status (2026-07-05):** Steps 1–5, 7, 8, and 10 done —
> migration (`20260705233121_game_scores_and_sync.sql`, incl. `manual_resolved`),
> provider lib (`src/lib/sports/`), extended `sync-schedule`, new `sync-results`
> endpoint (accepts `CRON_SECRET` bearer for cron), manual-override protection
> in the games PATCH route, admin Results UI (Sync Results button, scores,
> last-synced, manual badge + reset), member scores on picks + leaderboard.
> 2026 season (id 3) bootstrapped via `scripts/gather-2026-schedules.ts`: pool
> weeks 0–18, CFB weeks 0–12 + NFL weeks 1–17 (1,078 games). `CFBD_API_KEY` is
> set; CFB games use cfbd ids, NFL uses ESPN (`espn-` prefix). Also fixed
> (`20260706005832_auth_hook_profiles_grant.sql`): the access-token hook read
> `profiles` as `supabase_auth_admin` and was blocked by RLS, so every JWT got
> role MEMBER; plus `raw_app_meta_data.role` backfill because `getUser()`-based
> checks read that, not hook claims.
> Remaining: Step 6 (pg_cron migration + CRON_SECRET), Step 9 (observability),
> Step 11 (tests).

## Goal
Move from manual result entry to **API-driven** game status and scoring for CFB (cfbd) and NFL (ESPN), while preserving an admin manual override path.

## Scope
- Schedule sync (already exists) — extend, don't replace.
- Results sync — new endpoint that pulls live status + final scores and auto-resolves FINAL games.
- Scheduled polling during game windows.
- UI surfacing of scores + auto-sync status.
- Manual override remains the source of truth when admin uses it.

Out of scope: real-time push (websockets), pre-game odds/spreads, player stats.

## Step 1 — Schema: add scores + sync metadata
**Migration** `supabase/migrations/<timestamp>_game_scores_and_sync.sql`:
- `games.home_score int null`
- `games.away_score int null`
- `games.last_synced_at timestamptz null` — when API last touched this row
- Default `games.resolution_mode = 'API'` for any row created by sync; manual creation defaults to MANUAL. (Schema default stays MANUAL; sync endpoint writes API explicitly.)
- Regenerate `src/types/database.ts` via `supabase gen types`.

Why: scores are needed for the UI and to derive winner deterministically. `last_synced_at` lets us throttle polling and show "last updated" timestamps.

## Step 2 — Extend `sync-schedule` to capture status + scores on initial pull
`src/app/api/admin/sync-schedule/route.ts`:
- cfbd `/games`: also map `home_points`, `away_points`, `completed` boolean. If `completed=true`, set status=FINAL, derive winner.
- ESPN scoreboard: each event has `competition.status.type.completed` and competitor `score`. Map status, scores, winner.
- Write `resolution_mode = 'API'`, `last_synced_at = now()`.
- If an incoming game is already FINAL on our side **and** was set by manual admin (audit log entry exists, or we add a `manual_override` flag — see Step 5), do NOT overwrite winner/scores.

## Step 3 — New endpoint: `POST /api/admin/sync-results`
File: `src/app/api/admin/sync-results/route.ts`.
- Input: `{ weekId }` (sport optional — defaults to both).
- For each sport, fetch from same upstream as schedule, but only update games already in DB for that week (no inserts of unknown games — those come from schedule sync).
- **Final scores only** (per decision): we do not track LIVE state or in-progress scores.
- For each game returned:
  - If upstream status is FINAL / completed:
    - Skip if our row has `manual_resolved = true` (admin override wins).
    - Else: call `resolve_game(p_game_id, derived_winner)` RPC — this already recalculates picks and weekly_scores in one tx.
    - Update `home_score`, `away_score`, `last_synced_at`.
  - If POSTPONED / CANCELLED: set status accordingly (existing PATCH logic for picks side-effects gets factored into a helper so both paths share it).
  - Otherwise (SCHEDULED / in-progress): only update `last_synced_at`. No score writes, no status change.
- Return `{ resolved: n, skipped_manual: n, errors: [...] }`.

Auth: admin-only via JWT (mirrors `sync-schedule`). Also accept a cron secret header (`Authorization: Bearer ${process.env.CRON_SECRET}`) so pg_cron can call it without a user session.

## Step 4 — Winner derivation helper
`src/lib/sports/winner.ts`:
- `deriveWinner(home: number, away: number): 'HOME' | 'AWAY' | 'PUSH'`
- Used by both schedule sync (when initial pull finds completed game) and results sync.

## Step 5 — Manual override protection
- Add `picks` audit table already exists. For game results: track via a new column `games.manual_resolved boolean default false` set true by `PATCH /api/admin/games/[id]` when admin enters a result, set false on API-driven resolution. Sync endpoints skip rows with `manual_resolved = true`.
- Admin UI surfaces a "Reset to API control" button on manually-resolved games.

## Step 6 — Scheduler: pg_cron + pg_net
**Decision: pg_cron.** Runs entirely in Supabase; no Vercel infra dependency.

Architecture:
- pg_cron fires every 10 minutes.
- The cron job is a Postgres function `public.cron_sync_results()` that:
  1. Checks if any in-flight games exist — i.e. an OPEN-week game with `kickoff_time` in `[now() - interval '4 hours', now()]` and status != FINAL. (4 hours covers a typical CFB/NFL game length plus buffer; matches the user-confirmed ~3 hour window.)
  2. If none, exits cheaply with a no-op log row — no HTTP call, no API quota burn.
  3. If yes, uses `pg_net.http_post` to POST to `/api/cron/sync-results` with `Authorization: Bearer <CRON_SECRET>` and `{ activeWeekIds: [...] }`.

Migration `supabase/migrations/<timestamp>_cron_sync_results.sql`:
- `create extension if not exists pg_cron;`
- `create extension if not exists pg_net;`
- Stash `CRON_SECRET` and `APP_URL` in Postgres via `alter database ... set app.cron_secret = '...'` (or use Supabase Vault for the secret).
- Create the `cron_sync_results()` function.
- `select cron.schedule('sync-results', '*/10 * * * *', $$ select public.cron_sync_results(); $$);`

Wrapper route `src/app/api/cron/sync-results/route.ts`:
- Validates `Authorization: Bearer ${CRON_SECRET}`.
- Body: `{ activeWeekIds: number[] }`.
- For each week, calls the results sync logic (extract Step 3's body into a shared `syncResultsForWeek(weekId)` helper so both the admin endpoint and this cron route call the same code).
- Returns summary; pg_net fires-and-forgets (response body is logged to `net._http_response` table).

Notes:
- pg_net is async — pg_cron job returns immediately after enqueuing the HTTP request.
- The 10-min cadence + 4-hour in-flight check means: outside game windows, the cron costs ~one trivial SELECT every 10 min. During game windows, ~6 HTTP calls per hour per active week.

## Step 7 — Admin UI updates
`src/app/(admin)/results/ResultsClient.tsx`:
- Add "Sync Results" button next to existing "Sync CFB" / "Sync NFL" — calls `/api/admin/sync-results`.
- Show `last_synced_at` per game.
- Show live scores when present.
- Show "Manually Resolved" badge with reset button.

## Step 8 — Member UI: final scores on resolved games
`src/app/(member)/picks/PicksClient.tsx` + `LeaderboardClient.tsx`:
- For FINAL games show `home_score - away_score` next to team names when present.
- WIN/LOSS/PUSH indicator already wired off `picks.points`; no change needed there.
- No LIVE scores per decision.

## Step 9 — Observability (optional, recommended)
Table `sync_runs (id, kind, week_id, started_at, ended_at, summary jsonb, error text)` — written by both sync endpoints. Surfaced on a small admin "Sync Activity" page.

## Step 10 — Env + config
`.env.local` additions:
- `CFBD_API_KEY` — confirm present (sync-schedule already requires it).
- `CRON_SECRET` — new, used by cron wrapper.

## Step 11 — Testing
- Unit test `deriveWinner`.
- Integration test for sync-results against a stub (mock fetch) covering: API-final → resolves; manually resolved → skipped; live → status only; postponed → unfreezes picks; cancelled → zeroes picks.
- Manual smoke test plan: run schedule sync against current CFB week, force a FINAL state in DB, call results sync, verify weekly_scores updated.

## Rollout order
1. Migration + types (Step 1).
2. Winner helper + extend schedule sync (Steps 2, 4).
3. Results sync endpoint (Step 3).
4. Manual override flag + UI (Step 5, Step 7).
5. Cron wrapper + Vercel cron (Step 6).
6. Member UI scores (Step 8).
7. Observability (Step 9) — only if we want it before season starts.

## Resolved decisions
- Scheduler: **pg_cron + pg_net** (not Vercel Cron).
- Scores: **FINAL only**, no LIVE polling or live UI.
- Cadence: **every 10 min**, gated by a Postgres-side in-flight check (active games within `now() - 4h` window).

## Remaining open questions
- cfbd free tier rate limits — confirm headroom for 10-min polling. Mitigation already in plan: cron only fires API calls when an in-flight game exists, so most weeks have zero cost.

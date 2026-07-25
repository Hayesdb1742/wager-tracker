## 1. Project Setup

- [x] 1.1 Initialize Next.js 14 project with App Router, TypeScript, and Tailwind CSS
- [x] 1.2 Create Supabase project and configure environment variables (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`)
- [x] 1.3 Install and configure `@supabase/supabase-js` and `@supabase/ssr`; create `src/lib/supabase/client.ts` and `src/lib/supabase/server.ts`
- [x] 1.4 Create Next.js middleware at `src/middleware.ts` that refreshes the Supabase session cookie on every request and protects `(admin)` routes by checking `app_metadata.role`
- [x] 1.5 Set up the App Router directory structure: route groups `(auth)`, `(member)`, `(admin)` with placeholder `layout.tsx` files
- [ ] 1.6 Configure Supabase Auth: disable email/password sign-in, enable magic link (OTP), set JWT expiry to 3600s, set refresh token rolling window to 30 days, configure custom SMTP (Resend)

## 2. Database Schema

- [x] 2.1 Create `profiles` table and `handle_new_user` trigger that inserts a profiles row on `auth.users` insert
- [x] 2.2 Create `invites` table
- [x] 2.3 Create `seasons` and `weeks` tables (including `close_mode`, `auto_close_at` scaffold fields)
- [x] 2.4 Create `games` table (including `resolution_mode`, `external_id`, `in_pool` fields)
- [x] 2.5 Create `picks` table with partial unique index `picks_one_lotw_per_member_week` enforcing one LOTW per member per week
- [x] 2.6 Create `pick_audit_log` table
- [x] 2.7 Create `weekly_scores` table with generated `total` column
- [x] 2.8 Generate Supabase TypeScript types (`supabase gen types typescript`) and save to `src/types/database.ts`

## 3. Row-Level Security Policies

- [x] 3.1 Enable RLS on all tables; write `picks` policies: own read, post-kickoff peer read, admin bypass all, own insert/update
- [x] 3.2 Write `profiles` policies: all authenticated users read display_name/role/is_active; users update own row; admin updates any row
- [x] 3.3 Write `weekly_scores`, `games`, `weeks`, `seasons` read policies (all authenticated); restrict writes to service role or Postgres functions
- [x] 3.4 Write `invites` and `pick_audit_log` policies: admin read/write only; service role insert for audit log

## 4. Auth Hook: Role in JWT

- [x] 4.1 Create a Supabase Auth Hook (custom access token hook) as a Postgres function that reads `profiles.role` and injects it into `app_metadata.role` in the JWT
- [x] 4.2 Register the hook in Supabase Auth settings and verify that the JWT returned after sign-in contains the role claim

## 5. Member Auth: Invite Flow

- [x] 5.1 Create `POST /api/admin/invites` route: validates admin role, inserts into `invites`, sends invite URL email via Supabase transactional email
- [x] 5.2 Create `/join` page (`app/(auth)/join/page.tsx`): reads `?token=` param, validates token against `invites` table (not expired, not used), shows display name input form
- [x] 5.3 On join form submit, call `supabase.auth.admin.inviteUserByEmail()` (server action), mark `invites.used_at`, store display name in a server-side cookie for post-signup profile write
- [x] 5.4 Create `GET /auth/callback` route handler that exchanges the Supabase code for a session, writes `display_name` to `profiles` from the cookie, then redirects to `/picks`
- [x] 5.5 Handle invite error states in `/join`: expired token, already used, email already has account

## 6. Member Auth: Login Flow

- [x] 6.1 Create `/login` page (`app/(auth)/login/page.tsx`) with email input that calls `supabase.auth.signInWithOtp()`
- [x] 6.2 Display generic "check your email" confirmation regardless of whether the email exists (per spec — do not reveal email existence)
- [x] 6.3 Handle expired magic link: detect `error=access_denied` in callback and show expiry message with "resend" option
- [x] 6.4 Create `/onboarding` page that prompts for display name if `profiles.display_name` is null post-login (catches edge cases)

## 7. Admin: Season & Week Management

- [x] 7.1 Create admin weeks list page (`app/(admin)/weeks/page.tsx`) showing all weeks for the current season with status badges
- [x] 7.2 Create "New Week" form: week number, required picks, opens_at, closes_at; POST to `/api/admin/weeks`; enforce unique week number per season
- [x] 7.3 Create "Close Week" action with confirmation modal; warn if unresolved games remain; call Postgres function `close_week(week_id)` which applies forfeit and LOTW penalties and sets week status to CLOSED
- [x] 7.4 Create "Reopen Week" action with confirmation modal (warns that penalties will be reversed on next close)
- [x] 7.5 Write `close_week(week_id)` Postgres function: calculate forfeit penalties per member, LOTW missing penalties, upsert into `weekly_scores`

## 8. Admin: Member Management

- [x] 8.1 Create admin members page showing all profiles with role, active status, and invite date
- [x] 8.2 Create "Invite Member" form (email input) that calls `POST /api/admin/invites`; reject if email already has an active account
- [x] 8.3 Create "Deactivate Member" action that sets `profiles.is_active = false` and calls `supabase.auth.admin.signOut(userId, 'global')` to revoke active sessions
- [x] 8.4 Create "Reactivate Member" action that sets `profiles.is_active = false`
- [x] 8.5 Add middleware check: if `profiles.is_active = false`, redirect deactivated users to a "account deactivated" page

## 9. Game Schedule Sync

- [x] 9.1 Create `POST /api/admin/sync-schedule` route that accepts `{ weekId, sport }` and fetches from the cfbd API (CFB) or ESPN API (NFL)
- [x] 9.2 Implement cfbd fetch: GET games for week/year, map to `games` table schema, upsert using `ON CONFLICT (sport, external_id) DO UPDATE`
- [x] 9.3 Implement ESPN fetch: GET NFL games for week, map to schema, upsert with same dedup logic
- [x] 9.4 Wrap both fetches in a single Postgres transaction; return success/failure summary to admin UI
- [x] 9.5 Create sync UI on admin week detail page: "Sync CFB" and "Sync NFL" buttons with last-synced timestamp and result summary

## 10. Admin: Pick Pool & Game Management

- [x] 10.1 Create admin game list for a week showing all games, kickoff times, pool status, and result status
- [x] 10.2 Create "Exclude Game" action with pick-orphan warning (count affected picks, require confirmation); set `games.in_pool = false`
- [x] 10.3 Create "Re-include Game" action (only allowed before kickoff); set `games.in_pool = true`
- [x] 10.4 Create "Mark Result" form for each game: HOME WIN / AWAY WIN / PUSH; calls `resolve_game(game_id, winner)` Postgres function
- [x] 10.5 Write `resolve_game(game_id, winner)` Postgres function: set game status to FINAL and winner, calculate `points` for all picks on the game, update `weekly_scores.pick_points` for all affected members in a single transaction
- [x] 10.6 Create "Correct Result" action on FINAL games with recalculation warning and explicit confirmation before calling `resolve_game` again
- [x] 10.7 Handle POSTPONED and CANCELLED game states: unfreeze picks on postpone, award 0 points and exclude from required count on cancel

## 11. Pick Entry

- [x] 11.1 Create picks page (`app/(member)/picks/page.tsx`) showing all in-pool games for the current open week, grouped by sport, sorted by kickoff time
- [x] 11.2 Render each game as a pick card with HOME / AWAY team buttons; locked games (kickoff passed) show frozen selection and "Locked" badge
- [x] 11.3 Implement pick save: on team selection, call `POST /api/picks` which upserts the pick; enforce kickoff lock server-side (reject if `now() >= game.kickoff_time`)
- [x] 11.4 Implement LOTW designation: toggle button on each pick card; call `POST /api/picks/lotw` which sets `is_lotw = true` on selected pick and `false` on previous LOTW in a single transaction; reject if game already kicked off
- [x] 11.5 Show pick count progress: "X / Y picks made" and LOTW set indicator; warn if approaching kickoff with picks below required count
- [x] 11.6 Handle "No active week" state: display message when no week is OPEN
- [x] 11.7 Implement optimistic UI for pick selection with error retry on network failure (per spec: no silent unsaved picks)

## 12. Admin: Pick Override

- [x] 12.1 Create admin pick overview table for a week: all members × all games grid showing each member's pick and LOTW status
- [x] 12.2 Create pick override action (inline in grid): ADMIN selects a different team; call `POST /api/admin/picks/override` which updates the pick and inserts into `pick_audit_log`
- [x] 12.3 Override on a FINAL game triggers recalculation warning + confirmation; on confirm, calls `resolve_game` to recalculate
- [x] 12.4 Show override indicator on member's pick sheet: display "Modified by admin — [timestamp]" on overridden picks
- [x] 12.5 Create audit log view accessible to admins showing full override history per week

## 13. Admin: LOTW Assignment

- [x] 13.1 Add LOTW assignment control to admin pick overview grid: assign or change LOTW for any member before week close
- [x] 13.2 Enforce one-LOTW constraint on admin assignment: clear previous LOTW and set new one atomically
- [x] 13.3 Reject LOTW assignment after week is CLOSED; display error message

## 14. Leaderboard

- [x] 14.1 Create weekly leaderboard page (`app/(member)/leaderboard/page.tsx`) sorted by `weekly_scores.total` desc, alpha tiebreaker; columns: rank, name, wins, losses, pushes, total, LOTW indicator
- [x] 14.2 Subscribe to `weekly_scores` Supabase Realtime channel (filtered by current `week_id`); update leaderboard in real time without page refresh
- [x] 14.3 Show each member's per-game pick results inline after kickoff (WIN/LOSS/PUSH/PENDING); reads from `picks` table (RLS post-kickoff visibility handles access)
- [x] 14.4 Create season leaderboard tab: SUM of closed week totals grouped by member; clearly exclude in-progress week from season total
- [x] 14.5 Create prior week / prior season archive selector (dropdown); loads historical leaderboard data

## 15. Historical Analytics

- [x] 15.1 Create analytics page (`app/(member)/analytics/page.tsx`) with all-time standings table: total points, seasons played, picks, W-L-P, win %
- [x] 15.2 Create per-member stats page (`app/(member)/stats/[memberId]/page.tsx`): overall W-L-P, win %, LOTW W-L-P, best/worst week, win/loss streaks, season-by-season points
- [x] 15.3 Add team tendencies section to member stats: most-picked teams with per-team W-L-P and win %
- [x] 15.4 Create league-wide team tendencies view: most-picked teams across all members with collective win %
- [x] 15.5 Create head-to-head comparison: member selects opponent, shows shared weeks played, wins/losses/ties, total point differential
- [x] 15.6 Add LOTW history section to member stats: W-L-P record, win %, list of recent LOTW picks with outcomes

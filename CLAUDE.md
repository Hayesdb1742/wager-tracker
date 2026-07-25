# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Commands

```bash
npm run dev              # dev server (localhost:3000)
npm run build            # production build — the only real pre-commit gate
npm run start            # serve the production build
npm run lint             # eslint (flat config, eslint-config-next)
npx tsc --noEmit         # typecheck

npx tsx scripts/gather-2026-schedules.ts   # one-shot season bootstrap (reads .env.local itself)

supabase db push                                          # apply migrations to the linked project
supabase migration new <name>                             # create a migration
supabase gen types typescript --project-id ehjowxwewpyqcevfaqse > src/types/database.ts
```

There is **no test framework configured** — no vitest/jest/playwright deps, no test files, no `test` script. Verification is `npm run build` plus clicking through the app. Don't claim tests pass; don't add a test runner unless asked.

`supabase link` works without a password; direct `psql`/migration-repair needs `SUPABASE_DB_PASSWORD` from `.env.local`.

## Stack

Next.js 16 (App Router) · React 19 · TypeScript strict · Tailwind v4 (`@import "tailwindcss"` in `src/app/globals.css`, no config file) · Supabase (Postgres + Auth) · deployed on Vercel. Path alias `@/*` → `./src/*`.

## Architecture

### Route groups, and the middleware trap

`src/app` uses three route groups: `(auth)`, `(member)`, `(admin)`. Route groups **don't add URL segments**, so admin pages live at `/weeks`, `/results`, `/members`, `/pick-grid` — *not* under `/admin`.

`src/middleware.ts` therefore only does useful work in its first half (redirect unauthenticated users to `/login`); its `pathname.startsWith("/admin")` role check matches nothing today. **Real admin authorization is per-route**: every admin page and every `/api/admin/*` handler independently checks

```ts
if (!user || user.app_metadata?.role !== "ADMIN") // redirect("/picks") or 403
```

Never drop that check on the assumption middleware covers it. Keep `!pathname.startsWith("/api/")` in the middleware's unauthenticated allowlist or API routes needed pre-auth get redirect-looped.

### Three Supabase clients — pick deliberately

| File | Client | Use |
|---|---|---|
| `src/lib/supabase/client.ts` | browser (publishable key) | client components |
| `src/lib/supabase/server.ts` | SSR cookie-bound (publishable key) | **authentication only** — `getUser()` in server components/route handlers |
| `src/lib/supabase/admin.ts` | service role | all data reads/writes on the server |

The dominant pattern: authenticate with the cookie-bound server client, then read and write with `createAdminClient()`. This **bypasses RLS**, so the RLS policies in the schema are a backstop, not the enforcement layer — authorization correctness lives in the page/route code (role check, kickoff-lock check, `in_pool` check). When adding a route, port the checks explicitly.

The env var is `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (not `..._ANON_KEY`). `SUPABASE_SERVICE_ROLE_KEY` must never gain a `NEXT_PUBLIC_` prefix.

### Auth (magic link, invite-only)

- **In Route Handlers, session cookies must be written onto the `NextResponse` object.** `next/headers` `cookieStore.set()` does not reliably reach the browser from a route handler. `src/app/(auth)/auth/callback/route.ts` is the reference: build `createServerClient` inline with `setAll` writing to `response.cookies`. Copy that shape for any handler that persists auth state.
- The callback handles both PKCE (`code` → `exchangeCodeForSession`) and OTP (`token_hash` + `type` → `verifyOtp`, used by admin-generated links).
- **Role lives in `auth.users.raw_app_meta_data`**, which is what `getUser().app_metadata` returns — *not* in the JWT claims that `custom_access_token_hook` injects. Changing anyone's role means dual-writing `profiles.role` **and** `admin.auth.admin.updateUserById(id, { app_metadata: { role } })`. See migration `20260706005832_auth_hook_profiles_grant.sql` for why (the hook runs as `supabase_auth_admin` and needs its own RLS policy on `profiles`).
- `GET /api/dev/magic-link?email=` returns a login URL as JSON to bypass the free-tier 3/hr SMTP limit. It is gated off in production and is slated for deletion once Resend SMTP is configured — suggest it first when local login fails.

### Server/client component split

Each interactive page is a pair: `page.tsx` is an async server component that authenticates, fetches with the admin client, and passes plain props to a sibling `XClient.tsx` (`"use client"`). Clients never talk to Supabase directly for mutations — they `fetch("/api/...")`, and the route handler re-validates. Next 16 async APIs apply: `params` and `searchParams` are Promises and must be awaited.

### Domain model

`seasons → weeks → games → picks`, plus `weekly_scores`, `invites`, `pick_audit_log`, and the standalone `teams` / `historical_picks` tables.

- **Pool weeks are calendar-aligned, not sport-aligned: pool week N = CFB week N + NFL week N−1.** Week 1 is college-only. Upstream APIs have no "week 0" — both providers fold it into week 1, split out by kickoff date.
- `weeks.required_picks` is the authoritative total; `required_cfb_picks` / `required_nfl_picks` are nullable and, when set, must sum to it (CHECK `weeks_pick_split_matches_total`). NULL means "split unspecified" — handle that case.
- `games.in_pool` marks which games are pickable. `picks.picked_team` is `'HOME' | 'AWAY'` only.
- One LOTW per member per week, enforced by partial unique index `picks_one_lotw_per_member_week`.
- Picks lock **per game at kickoff**, not per week. `/api/picks` re-checks `kickoff_time` server-side and returns 409 `pick_locked`.

### Scoring lives in Postgres, not TypeScript

Points are computed by SQL functions in `supabase/migrations/20240101000000_initial_schema.sql`:

- `resolve_game(p_game_id, p_winner)` — marks the game FINAL, scores every pick on it (win +1 / LOTW win +2 / loss −1 / LOTW loss −2, push 0), then rolls those into `weekly_scores.pick_points`.
- `close_week(p_week_id)` — applies forfeit penalty (−1 per unfilled required slot) and LOTW penalty (−1 if none designated), then sets the week CLOSED. Called via `admin.rpc("close_week", ...)`; the route refuses unless all games are resolved or `force: true` is passed.
- `weekly_scores.total` is a generated column.

Changing scoring rules means writing a migration, not editing app code.

### Sports API sync (`src/lib/sports/`)

`providers.ts` normalizes upstream payloads into `UpstreamGame`; `sync.ts` upserts them; `winner.ts` derives HOME/AWAY/PUSH from scores.

- CFB: collegefootballdata.com when `CFBD_API_KEY` is set, otherwise ESPN's keyless scoreboard. NFL: ESPN only.
- **`external_id` convention:** cfbd ids stored bare, ESPN-sourced ids prefixed `espn-`. Results sync routes each game back to its provider by that prefix — don't strip or normalize it.
- Upserts key on `(sport, external_id)` and **never overwrite a game with `manual_resolved = true`**; admin-entered results always win.
- `POST /api/admin/sync-results` accepts either an admin session or `Authorization: Bearer ${CRON_SECRET}` so pg_cron/pg_net can call it without a user.
- `UpstreamStatus` has no `LIVE`: in-progress games stay `SCHEDULED` until `FINAL`.

## Database changes

Migrations are timestamped files in `supabase/migrations/`. Seeds: `supabase/seeds/dev_seed.sql` and `supabase/seed_2024_historical.sql` (648 free-form 2024 bet rows in `historical_picks`, deliberately kept out of `picks` because the old format was spreads/MLs, not pick-one-winner). After any schema change, regenerate `src/types/database.ts` — every client is typed `<Database>` and stale types fail the build.

## Specs

Behavioral specs are the source of truth and are more detailed than this file: `openspec/changes/betting-tracker/specs/<capability>/spec.md` (member-auth, pick-entry, pick-visibility, scoring-engine, result-resolution, leaderboard, historical-analytics, admin-management, game-schedule-sync). `design.md` and `tasks.md` sit alongside; `plans/` holds the sports-API and Vercel deployment plans. Read the relevant spec before changing behavior in that area. The `openspec-*` skills manage proposing/applying/archiving changes.

## Environment

`.env.local` (gitignored, never commit): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DB_PASSWORD` (CLI only — not set in Vercel), `CFBD_API_KEY`, `CRON_SECRET` (must match the Supabase Vault `cron_secret`).

Git flow: work on `develop`, PR into `main` (remote is `Hayesdb1742/wager-tracker` — the deployment plan's older `betting-site` name is stale). `main` is the Vercel production branch.

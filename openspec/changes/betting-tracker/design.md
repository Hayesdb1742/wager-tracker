## Context

Greenfield Next.js 14+ / Supabase application for a private 8–12 person football pick league. No existing codebase to migrate. All capabilities are new. The stack is decided in the proposal: Next.js (App Router), Supabase (Postgres + Auth + RLS + Realtime), Vercel deployment, Python sync script in Day 2. This document covers the technical decisions required before writing tasks.

## Goals / Non-Goals

**Goals:**
- Define the full database schema with all tables, relationships, and Day 2 scaffold fields
- Decide the Supabase auth + invite flow implementation
- Specify RLS policy structure for pick visibility enforcement
- Decide scoring storage model (on-the-fly vs materialized)
- Decide the Day 1 sync job approach
- Identify the Next.js project structure (App Router conventions, route groups)

**Non-Goals:**
- Line-by-line implementation details (covered in tasks)
- UI design / visual layout decisions
- Day 2 FastAPI service design
- Push notification strategy (deferred in proposal)

## Decisions

### 1. Database Schema

#### `profiles`
Extends `auth.users`. Created automatically via Supabase `handle_new_user` trigger on `auth.users` insert.

```
profiles
  id          uuid PK → auth.users.id
  display_name text NOT NULL
  role        text NOT NULL DEFAULT 'MEMBER'  -- 'ADMIN' | 'MEMBER'
  is_active   bool NOT NULL DEFAULT true
  created_at  timestamptz NOT NULL DEFAULT now()
```

**Why a separate profiles table over custom JWT claims only:** We need `display_name` and `is_active` in the DB regardless. The role is injected into the JWT via a Supabase Auth Hook (custom access token hook) so server-side route handlers get role without an extra query.

#### `invites`
```
invites
  id          uuid PK DEFAULT gen_random_uuid()
  email       text NOT NULL
  token       uuid NOT NULL UNIQUE DEFAULT gen_random_uuid()
  invited_by  uuid NOT NULL → profiles.id
  created_at  timestamptz NOT NULL DEFAULT now()
  expires_at  timestamptz NOT NULL DEFAULT now() + interval '72 hours'
  used_at     timestamptz NULL
```

#### `seasons`
```
seasons
  id          serial PK
  name        text NOT NULL        -- e.g. '2024 Season'
  year        int NOT NULL UNIQUE
  created_at  timestamptz NOT NULL DEFAULT now()
```

#### `weeks`
```
weeks
  id              serial PK
  season_id       int NOT NULL → seasons.id
  week_number     int NOT NULL
  required_picks  int NOT NULL
  opens_at        timestamptz NOT NULL
  closes_at       timestamptz NOT NULL
  status          text NOT NULL DEFAULT 'OPEN'  -- 'OPEN' | 'CLOSED'
  close_mode      text NOT NULL DEFAULT 'MANUAL'  -- 'MANUAL' | 'AUTO' (Day 2 scaffold)
  auto_close_at   timestamptz NULL               -- Day 2 scaffold
  UNIQUE (season_id, week_number)
```

#### `games`
```
games
  id               uuid PK DEFAULT gen_random_uuid()
  week_id          int NOT NULL → weeks.id
  sport            text NOT NULL  -- 'CFB' | 'NFL'
  home_team        text NOT NULL
  away_team        text NOT NULL
  kickoff_time     timestamptz NOT NULL
  status           text NOT NULL DEFAULT 'SCHEDULED'  -- 'SCHEDULED' | 'LIVE' | 'FINAL' | 'POSTPONED' | 'CANCELLED'
  winner           text NULL  -- 'HOME' | 'AWAY' | 'PUSH'
  in_pool          bool NOT NULL DEFAULT true
  external_id      text NOT NULL  -- cfbd or ESPN game ID
  resolution_mode  text NOT NULL DEFAULT 'MANUAL'  -- 'MANUAL' | 'API' (Day 2 scaffold)
  created_at       timestamptz NOT NULL DEFAULT now()
  UNIQUE (sport, external_id)
```

#### `picks`
```
picks
  id             uuid PK DEFAULT gen_random_uuid()
  member_id      uuid NOT NULL → profiles.id
  game_id        uuid NOT NULL → games.id
  week_id        int NOT NULL → weeks.id   -- denormalized for query efficiency
  picked_team    text NOT NULL  -- 'HOME' | 'AWAY'
  is_lotw        bool NOT NULL DEFAULT false
  points         int NULL  -- NULL until game resolved
  overridden_by  uuid NULL → profiles.id
  overridden_at  timestamptz NULL
  created_at     timestamptz NOT NULL DEFAULT now()
  updated_at     timestamptz NOT NULL DEFAULT now()
  UNIQUE (member_id, game_id)
```

One-LOTW-per-member-per-week enforced via partial unique index:
```sql
CREATE UNIQUE INDEX picks_one_lotw_per_member_week
  ON picks (member_id, week_id)
  WHERE is_lotw = true;
```

#### `pick_audit_log`
```
pick_audit_log
  id             uuid PK DEFAULT gen_random_uuid()
  pick_id        uuid NOT NULL → picks.id
  previous_team  text NOT NULL
  new_team       text NOT NULL
  changed_by     uuid NOT NULL → profiles.id
  changed_at     timestamptz NOT NULL DEFAULT now()
```

Append-only. Never deleted.

#### `weekly_scores`
```
weekly_scores
  id              uuid PK DEFAULT gen_random_uuid()
  member_id       uuid NOT NULL → profiles.id
  week_id         int NOT NULL → weeks.id
  pick_points     int NOT NULL DEFAULT 0
  forfeit_penalty int NOT NULL DEFAULT 0  -- stored as negative int
  lotw_penalty    int NOT NULL DEFAULT 0  -- stored as negative int
  total           int GENERATED ALWAYS AS (pick_points + forfeit_penalty + lotw_penalty) STORED
  UNIQUE (member_id, week_id)
```

Season totals are a simple `SUM(total)` over `weekly_scores` grouped by member — no separate `season_scores` table needed.

---

### 2. Auth + Invite Flow

**Chosen approach:** Custom invite table + Supabase OTP magic link.

Flow:
1. Admin submits an email → API route inserts row into `invites`, sends a custom invite URL (e.g. `/join?token=<uuid>`) via Supabase transactional email or direct SMTP.
2. Invitee opens `/join?token=<uuid>` → page validates token (not expired, not used, email matches) → shows display name input form.
3. On form submit → API route calls `supabase.auth.admin.inviteUserByEmail(email, { redirectTo: '/auth/callback' })` which sends a magic link. The invite token is marked `used_at = now()` atomically.
4. Invitee clicks magic link → Supabase handles session → `handle_new_user` trigger creates `profiles` row with `role = 'MEMBER'`.
5. Display name is written to `profiles` immediately after session is established (redirect to `/onboarding` if `display_name` is null).

**Why not `supabase.auth.admin.inviteUserByEmail` alone:** Supabase's built-in invite creates the user immediately and doesn't support a pre-signup display name step. The custom token lets us control the flow.

**Session duration:** Supabase JWT expiry set to 3600s (1h); refresh token rolling window set to 30 days via `auth.config` (matches spec).

**Role in JWT:** A Supabase Auth Hook (custom access token hook) reads `profiles.role` and injects it as `app_metadata.role` into the JWT. Next.js middleware reads `app_metadata.role` from the session token for route protection without an extra DB query.

---

### 3. RLS Policies

All application data access goes through Supabase's PostgREST API. RLS is the enforcement layer.

**`picks` table:**
```sql
-- Members can always read their own picks
CREATE POLICY picks_own_read ON picks FOR SELECT
  USING (member_id = auth.uid());

-- Members can read other members' picks only after kickoff
CREATE POLICY picks_post_kickoff_read ON picks FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM games g
      WHERE g.id = picks.game_id
        AND g.kickoff_time < now()
    )
  );

-- Admins bypass all pick restrictions
CREATE POLICY picks_admin_all ON picks FOR ALL
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'ADMIN');

-- Members insert/update own picks only (server checks kickoff before calling)
CREATE POLICY picks_own_write ON picks FOR INSERT
  WITH CHECK (member_id = auth.uid());

CREATE POLICY picks_own_update ON picks FOR UPDATE
  USING (member_id = auth.uid());
```

**`profiles` table:**
- All authenticated users can SELECT all profiles (display_name, role, is_active — never email).
- Users can UPDATE only their own profile.
- ADMIN can UPDATE any profile (for deactivation).

**`weekly_scores`, `games`, `weeks`, `seasons`:** readable by all authenticated users; writable only by ADMIN or via server-side functions (scored via Postgres functions, not direct client writes).

---

### 4. Scoring Model: Materialized in `weekly_scores`

**Decision:** Points are computed and stored at write time, not calculated on-the-fly.

**Trigger points:**
- When admin marks a game result → Postgres function `resolve_game(game_id, winner)` updates `picks.points` for all picks on that game, then recalculates `weekly_scores.pick_points` for all affected members.
- When admin closes a week → Postgres function `close_week(week_id)` calculates forfeit and LOTW penalties, writes them to `weekly_scores`.

**Why materialized vs on-the-fly:** The leaderboard is the most-read screen. Real-time updates via Supabase Realtime require a stable table to subscribe to. Recalculation scope is bounded to ~12 members per game result — acceptable overhead.

**Supabase Realtime:** Subscribe to `weekly_scores` table changes (filtered by `week_id`). Leaderboard page uses `useEffect` + Supabase client subscription. No separate websocket infra needed.

---

### 5. Day 1 Sync Job: Next.js API Route

**Decision:** Schedule sync is an admin-triggered Next.js API route (`POST /api/admin/sync-schedule`) that fetches from cfbd and ESPN directly in the request lifecycle.

**Why not Python/GitHub Actions in Day 1:** Eliminates separate infra and deployment surface. The proposal already flags this as a Day 2 addition. A Next.js API route with a 60s timeout (Vercel Pro) is sufficient to fetch and upsert a week's worth of games.

**Upsert key:** `UNIQUE(sport, external_id)` — `ON CONFLICT DO UPDATE SET kickoff_time = EXCLUDED.kickoff_time, ...`

**Error handling:** If either API call fails, the entire upsert is rolled back (transaction). Admin sees success/failure summary.

---

### 6. Next.js Project Structure

```
src/
  app/
    (auth)/
      login/page.tsx          # magic link request
      join/page.tsx           # invite token → display name → OTP
      auth/callback/route.ts  # Supabase auth callback handler
    (member)/
      picks/page.tsx
      leaderboard/page.tsx
      stats/[memberId]/page.tsx
      analytics/page.tsx
    (admin)/
      layout.tsx              # admin role guard
      weeks/page.tsx
      results/page.tsx
      members/page.tsx
      sync/page.tsx
    layout.tsx                # root layout, session provider
  lib/
    supabase/
      client.ts               # browser client
      server.ts               # server component client (cookies)
      middleware.ts            # route protection
  components/
  types/
    database.ts               # generated Supabase types
```

Route groups `(auth)`, `(member)`, `(admin)` keep layouts separate without affecting URLs. Middleware protects `(admin)` routes by checking `app_metadata.role` from JWT.

---

## Risks / Trade-offs

**RLS misconfiguration exposes picks early**
→ Mitigation: integration test suite that authenticates as a MEMBER and asserts pre-kickoff picks from other members return 0 rows. Run on every PR.

**Supabase free tier SMTP rate limit (3 emails/hour)**
→ Mitigation: configure custom SMTP (Resend) before any real usage. Document as a required setup step.

**ESPN unofficial API has no SLA**
→ Mitigation: wrap in try/catch, log errors, surface to admin UI. Sync is manual in Day 1 so admin knows immediately if it fails. Manual game entry is the fallback.

**`resolve_game` Postgres function must be atomic**
→ If scoring recalculation partially fails, leaderboard shows wrong data. Mitigation: wrap entire recalculation in a single transaction; on error, Postgres rolls back automatically.

**Vercel serverless timeout for sync**
→ A single week has ~50–100 games. Two API calls + upserts should complete in < 10s. If Vercel Hobby (10s limit) is used, upgrade to Pro or move to an Edge Function with streaming response.

## Migration Plan

Greenfield — no migration from existing system. Deploy order:

1. Supabase project creation: schema, RLS policies, Auth config (SMTP, JWT expiry, Auth Hook)
2. Vercel project creation, environment variables linked to Supabase
3. Seed: create initial ADMIN user manually via Supabase dashboard
4. Deploy and smoke test invite flow end-to-end
5. Admin creates first season and week; runs manual sync
6. Members receive invite links

Rollback: Supabase project can be reset to a prior migration; Vercel supports instant rollback to prior deployment.

## Open Questions

- **Custom SMTP provider:** Resend vs SendGrid vs Postmark? Resend is simplest to configure with Supabase. Recommend Resend unless the user has an existing preference.
- **PWA setup:** Is a `manifest.json` and service worker in scope for Day 1, or deferred? Proposal says "PWA/mobile-first" — needs clarification on whether install-to-homescreen is a Day 1 requirement.
- **Season creation:** Is there an admin UI for creating seasons, or is the first season seeded manually? The spec covers week creation but not season creation explicitly.

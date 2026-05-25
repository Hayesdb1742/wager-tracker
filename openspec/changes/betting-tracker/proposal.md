## Why

A friend group runs a weekly football betting league (8–12 members, college football + NFL) with no dedicated tool to manage picks, track points, or view standings — everything is done manually. This app gives the league a purpose-built home for pick submission, live leaderboard tracking, and season-long analytics.

## What Changes

This is a greenfield application. All capabilities are new.

- Members can log in via magic link (email) — no passwords, invite-only
- An admin syncs weekly game schedules automatically from free public APIs (cfbd for CFB, ESPN unofficial for NFL)
- Each week, an admin sets a **required pick count** (e.g., 8, 10, or 12 games)
- Members submit picks from the full available game pool, designating exactly one as their **Lock of the Week (LOTW)**
- Individual picks lock at each game's kickoff time — not all at once
- Picks are **blind** (hidden from other members) until a game's kickoff; admin can see all picks at any time
- Admin can override any member's pick (with a full audit trail)
- If a member fails to designate an LOTW before all their games lock, admin can assign one; if not done before week close, the member receives an automatic **-1 point penalty**
- Unpicked game slots (below the required pick count) each cost **-1 point** (forfeit)
- Scoring: **+1 win / 0 push / -1 loss** for regular picks; **+2 / 0 / -2** for LOTW
- Admin resolves game results manually (Day 1); API-based auto-resolution is a Day 2 addition
- A leaderboard shows weekly and season-long standings, updating in real time as games are resolved
- A historical analytics view surfaces trends across the full league history

## Capabilities

### New Capabilities

- `member-auth`: Invite-only magic link authentication; member profiles with ADMIN or MEMBER role
- `game-schedule-sync`: Weekly automated pull of CFB (cfbd API) and NFL (ESPN API) schedules into the database; admin can exclude specific games from the pick pool
- `pick-entry`: Member pick submission UI — select a team for each game, designate one LOTW, edit until individual game kickoff
- `pick-visibility`: Blind-pick enforcement (picks hidden from peers pre-kickoff, visible post-kickoff; admin sees all); pick override by admin with audit log
- `scoring-engine`: Point calculation logic — regular picks (+1/-1/0), LOTW (+2/-2/0), forfeit penalties (-1 per unpicked slot below required count), LOTW missing penalty (-1 if not set by week close)
- `result-resolution`: Admin UI for marking game winners (WIN/LOSS/PUSH); triggers scoring recalculation; Day 2 hook for automated API-based resolution
- `leaderboard`: Real-time weekly and season standings; updates as results are resolved
- `historical-analytics`: Season and all-time stats — member win rates, best/worst weeks, team pick tendencies, head-to-head records
- `admin-management`: Week creation (required pick count, open/close dates), LOTW manual assignment, week close-out workflow

### Modified Capabilities

None — greenfield project.

## Impact

**Tech stack (decided):**
- Frontend: Next.js 14+ (App Router, React, PWA/mobile-first)
- Database + Auth + Realtime: Supabase (PostgreSQL, magic link auth, RLS for pick visibility, Realtime for leaderboard)
- Schedule sync: Python script on GitHub Actions cron (weekly)
- Deployment: Vercel (frontend) + Supabase (hosted)
- Day 2 backend: FastAPI (Python) for automated result resolution via sports APIs

**External dependencies:**
- collegefootballdata.com API (free, requires key) — CFB schedules and scores
- ESPN unofficial API (free, no key) — NFL schedules and scores

**Key constraints:**
- Exactly one `is_lotw = true` pick per member per week — enforced server-side
- Pick edits rejected server-side if `now() >= game.kickoff_time`
- Pick visibility enforced at the database layer via Supabase Row-Level Security (not just UI)
- Admin pick overrides stored with `overridden_by` and `overridden_at` for audit trail
- Week `required_picks` count set per-week by admin; may vary week to week

**Decided:**
- Forfeit penalties accrue at **week close**, not game-by-game
- Week close is **manual admin action** (Day 1); the schema must scaffold an `auto_close_at` timestamp field and a `close_mode: MANUAL | AUTO` flag so automated close-out can be added without a migration later
- Push notification strategy: deferred — PWA first, revisit if the group needs iOS-reliable notifications

**Open decisions (deferred):**
- Push notification strategy: PWA push (Android reliable, iOS 16.4+ only) vs. email digest — decide when mobile requirements are clearer

# Betting Tracker

A private web app for a friend group's weekly football betting league. Members submit picks on college football and NFL games each week, compete on a live leaderboard, and track performance over a full season.

---

## What It Does

- **Pick Entry** — Members pick a team for each game from the weekly pool. One pick per week must be designated as the Lock of the Week (LOTW), worth double. Once a season, a member may raise that week's lock to the Lock of the Year (LOTY), worth seven.
- **Live Leaderboard** — Standings update in real time as the admin enters game results on Sunday. Picks stay hidden from other members until each game kicks off.
- **Season Tracking** — Cumulative points tracked across the full season. Historical analytics show win rates, team tendencies, and head-to-head records.
- **Admin Tools** — One admin manages weekly setup, enters game results, and can override picks or assign LOTWs when needed.

---

## Scoring

A lock's weight is its weight **in games as well as in points** — the league reads the record, not the point total, so a lock has to show up in the W‑L.

| Result | Regular Pick | Lock of the Week | Lock of the Year |
|--------|-------------|------------------|------------------|
| Win    | +1 · 1 W    | +2 · 2 W         | +7 · 7 W         |
| Push   | 0 · 1 P     | 0 · 1 P          | 0 · 1 P          |
| Loss   | −1 · 1 L    | −2 · 2 L         | −7 · 7 L         |

So a member who goes 2–3 on the week with the LOTW among the losses reads **2–4**; with the LOTY among them, **2–9**. A push is a no‑action and stays one row however it was locked.

**One lock per week, one LOTY per season.** A LOTY stands in place of that week's LOTW rather than sitting beside it — spend it in week 4 and you have no separate LOTW that week.

**Forfeit penalty:** −1 point per pick slot not filled by week close (e.g., if 10 picks are required and you submit 8, you lose 2 points).

**LOTW missing penalty:** −1 point if no Lock of the Week is designated before the week closes.

---

## Tech Stack

| Layer | Tool | Why |
|-------|------|-----|
| Frontend | [Next.js 14+](https://nextjs.org) | React framework, works as a mobile PWA, includes API routes |
| Database & Auth | [Supabase](https://supabase.com) | Postgres, magic link login, real-time updates, row-level security |
| Schedule sync | Python script (GitHub Actions) | Pulls CFB + NFL schedules weekly from free public APIs |
| Deployment | [Vercel](https://vercel.com) | Zero-config Next.js hosting, free tier |

**External APIs (free):**
- [collegefootballdata.com](https://collegefootballdata.com) — College football schedules and scores
- ESPN unofficial API — NFL schedules and scores

---

## Project Structure

```
betting-site/
├── openspec/
│   └── changes/
│       └── betting-tracker/
│           ├── proposal.md          # What we're building and why
│           └── specs/
│               ├── member-auth/         # Login, roles, invites
│               ├── game-schedule-sync/  # API schedule pull
│               ├── pick-entry/          # Member pick submission
│               ├── pick-visibility/     # Blind picks + admin override
│               ├── scoring-engine/      # Point rules, forfeits, LOTW
│               ├── result-resolution/   # Admin enters game results
│               ├── leaderboard/         # Weekly + season standings
│               ├── historical-analytics/# All-time stats and trends
│               └── admin-management/    # Week setup, close-out, invites
└── README.md
```

---

## Key Rules & Decisions

- **Pick locks are per-game**, not per-week. A pick locks the moment that game kicks off.
- **Picks are blind** — you cannot see what other members picked until a game kicks off.
- **Forfeit penalties apply at week close**, not as games lock throughout the week.
- **Weeks are closed manually** by the admin. The schema is built to support automatic close-out in a future update without requiring a database change.
- **Admin can override** any member's pick at any time. All overrides are logged with a timestamp.
- **Invite-only** — there is no public sign-up. The admin sends a magic link to new members by email.

---

## Day 1 vs Day 2

**Day 1 (this build):**
- Admin manually enters game results
- Admin manually triggers schedule sync
- Admin manually closes weeks
- Login via email magic link (no passwords)
- Mobile-first responsive web app (PWA)

**Day 2 (planned):**
- Automated result resolution via sports APIs
- Scheduled weekly sync via cron
- Automated week close-out
- Push notifications for pick reminders

---

## For Developers

The full behavioral specs for every feature live in `openspec/changes/betting-tracker/specs/`. Read those before writing any code — they define exactly what the system must do, including edge cases and admin workflows. The proposal at `openspec/changes/betting-tracker/proposal.md` explains the overall scope and the decisions made during planning.

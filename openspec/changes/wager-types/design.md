## Context

The original spec deliberately chose straight-up picking. `openspec/changes/betting-tracker/
proposal.md` says "select a team for each game" and "+1 win / 0 push / -1 loss"; the word
"spread" appears in no spec file. That was a real decision, not an oversight — but it does not
describe how this league bets.

Re-parsing all 648 rows of 2024 history in `historical_picks.bet_text`:

| Shape | Count |
|---|---:|
| Spreads (292 signed like `Giants +7`, 138 unsigned like `Bears 1.5`) | **430** |
| Totals (81 with a number, 8 without) | **89** |
| Moneylines (`Jets ML`) | 26 |
| LOTW placeholder — `bet_text` is the literal string `LOTW`, no bet detail | 84 |
| Team-only, undecidable | 19 |

All three of the bet types in this change are already present in league history. Totals are
the third-largest shape, not an outlier — `docs/database-architecture-review.md` F3 records
"one is a total", which is wrong by ~89×, and undercounts spreads by the 138 unsigned rows.

**Constraint that sets the timing:** `picks`, `pick_audit_log` and `weekly_scores` hold zero
rows all-time. There is also no local Postgres stack (`docs/local-startup.md:7`) — migrations
apply straight to the live database the league uses.

## Goals / Non-Goals

**Goals:**
- Members record the wager they actually placed, including their own number.
- One grading path covers all three bet types.
- Store the price now so the future -120 rule is a constraint to add, not a data migration.
- Make it impossible to record a wager whose type, selection and line disagree.

**Non-Goals:**
- Enforcing the -120 rule.
- Sourcing or verifying lines from a provider.
- Reconciling the 2024 `bet_text` history.
- Changing point values, LOTW rules, or the forfeit rule (W4, handled separately).

## Decisions

### 1. The line lives on the pick, entered by the member

Members bet across different books at different times, so there is no single correct number
for a game. A per-game line would force everyone onto one number that matches nobody's actual
bet, and it would leave per-bet prices nowhere to live — which the future -120 rule requires.

*Alternative rejected:* one official line per game, admin- or provider-set. Cleaner to grade
and needs no trust, but it records a bet nobody placed. CFBD's `/lines` endpoint would supply
it under the existing `CFBD_API_KEY`, keyed by the `external_id` already stored, if
verification is ever wanted.

*Trade-off accepted:* lines are an honour system. `pick_audit_log` records every change.

### 2. The line is stored from the selected side's perspective

Taking Michigan +3.5 stores `line = 3.5`; taking them -3.5 stores `line = -3.5`. The sign is
always relative to the side the member took, never to the home team.

This is what lets one comparison grade everything: `selected_score + line` vs
`opponent_score`. A moneyline is that comparison with `line = 0`, which is why `ML` needs no
branch of its own.

*Alternative rejected:* storing the line home-relative (the sportsbook convention). It makes
grading conditional on which side was taken and inverts the sign on every away pick — one more
place to get a minus sign wrong, for no gain.

### 3. `ML` is a distinct bet type, not `SPREAD` with a line of 0

Grading is identical, but the intents are not: taking a team outright is a different bet from
a genuine pick'em, and the -120 rule will treat them differently — a heavy favourite's
moneyline is exactly the bet that rule exists to catch. Collapsing them makes that
indistinguishable in history.

### 4. One wager per member per game

`unique (member_id, game_id)` is retained. A week's required pick count stays a row count,
the forfeit math in `close_week` is untouched, and the pick-grid stays one cell per member per
game.

*Alternative rejected:* `unique (member_id, game_id, bet_type)`, allowing a side and a total
on the same game. It changes what "5 picks" counts and forces a restructure of the pick-grid
for a case the league has not asked for.

### 5. `bet_type` and `line` are `not null` with **no default**

Available only because `picks` is empty. Two consequences, both wanted:

- No wager can be silently recorded as a moneyline it wasn't. A caller that omits the bet type
  fails loudly instead of guessing.
- It forces a hard cutover: the migration, `POST /api/picks` and `PicksClient` ship together.
  The schema cannot land first and wait for the UI.

### 6. Resolution becomes score-driven

`resolve_game(game_id, winner)` → `resolve_game(game_id, home_score, away_score)`. A spread or
a total cannot be graded from "HOME won". `games.winner` is still derived and stored, but only
for display; grading reads the scores.

The score-to-winner derivation stays in `src/lib/sports/winner.ts` (`deriveWinner`) rather
than being re-implemented in SQL, so there is one definition of a tie.

### 7. Grading lives in SQL, in `grade_pick()`

An immutable SQL function returning `WIN|LOSS|PUSH`, called by `resolve_game`. Keeping it in
the database keeps scoring atomic with the result write, matches the existing materialised
scoring model (`betting-tracker/design.md` §4), and makes the truth table directly testable
with a `SELECT` before any application code exists.

Point values remain in `resolve_game`: `WIN` → ±1, or ±2 when `is_lotw`; `PUSH` → 0.

## Risks / Trade-offs

**`resolve_game`'s signature change is the sharp edge** → three call sites plus the checked-in
types. `npx tsc --noEmit` catches all of them; the types must be regenerated first or it
checks against a stale schema.

**Recreating `resolve_game` drops its grants** → re-grant exactly what exists today. The
function is `security definer` and granted to `anon` (F1), which is accepted risk and out of
scope for this change; it must not silently change in either direction.

**Migrations apply to the live database** → land while week 2 is still `CLOSED` and no member
can be mid-entry.

**Pushes become common** → members enter whole-number lines, so `PUSH` stops being the rare
tie case it is under straight-up scoring. `points = 0` already means push in six read sites,
where it is also already conflated with a cancelled game's zero. Centralising the decode in
`src/lib/wagers.ts` is the chance to separate them.

**Honour-system lines** → nothing verifies a member's number until the price rule ships.
Mitigated only by the audit log and a league of eight people who know each other.

## Migration Plan

1. Migration: rename `picked_team` → `selection`, add `bet_type`/`line`/`odds` with their
   constraints, widen `pick_audit_log`, add the two missing indexes.
2. `grade_pick()`, then rewrite `resolve_game()`, re-granting as before.
3. Regenerate `src/types/database.ts` (`supabase gen types typescript --linked`).
4. `src/lib/wagers.ts`, then routes, then UI — one push.
5. Verify `grade_pick` against its truth table by direct `SELECT` before trusting any UI.

**Rollback:** the inverse migration restores `picked_team` and the old `resolve_game`. Safe
only while `picks` is empty — once wagers land, a rollback loses `bet_type`, `line` and
`odds`, and every non-`ML` wager becomes an unrecoverable bare team pick.

## Open Questions

- **"-120 or longer"** is read here as `odds >= -120`: -110 and +140 pass, -150 fails. Confirm
  before the price rule is implemented.
- Whether `odds` should become required once the price rule ships, or stay optional with the
  rule applying only when a price is given.

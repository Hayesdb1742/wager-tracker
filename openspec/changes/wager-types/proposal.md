## Why

The league bets against the spread and on over/under totals. The app models neither — a pick
is a bare `HOME`/`AWAY` team choice, scored straight up. That gap makes the 2026 season a
different game from the one this group has always played, and it is the open decision W3 in
`docs/database-remediation-backlog.md`.

Now, because `picks`, `pick_audit_log` and `weekly_scores` hold **zero rows all-time**. Every
column here is an `ADD COLUMN` today and a data migration the moment real wagers land.

## What Changes

- A pick becomes a **wager**: a bet type, a selection, a line, and an optional price.
- Three bet types are valid — `ML` (straight up), `SPREAD` (against the spread), and `TOTAL`
  (over/under).
- **Members enter their own line.** The league bets across different books at different
  times, so two members may hold different numbers on the same game. Lines are not sourced
  from a provider and are not verified against one.
- One wager per member per game. `unique (member_id, game_id)` is unchanged, so a week's
  required pick count stays a simple row count.
- **BREAKING** — `picks.picked_team` is renamed to `picks.selection` and widened from
  `HOME|AWAY` to `HOME|AWAY|OVER|UNDER`.
- **BREAKING** — `resolve_game(game_id, winner)` becomes
  `resolve_game(game_id, home_score, away_score)`. A spread cannot be graded from "HOME won",
  so resolution must carry the actual scores.
- **BREAKING** — the admin result screen captures final scores instead of a HOME/AWAY/PUSH
  button.
- Wager prices are stored as American odds and range-checked as plausible. A future change
  will reject anything shorter than -120; **this change does not enforce that rule.**
- Point values are untouched: +1/-1 regular, +2/-2 LOTW, 0 for a push. Only the *definition*
  of win/loss/push moves — from "picked the winning team" to "the wager graded".

## Capabilities

### New Capabilities

None. This changes how an existing capability behaves rather than adding a new one.

### Modified Capabilities

- `pick-entry`: a member composes a wager (type, selection, line, optional price) instead of
  selecting a team. Saving moves from "immediately on selection" to "once the wager is
  complete and valid" — a half-typed line must not persist.
- `scoring-engine`: win/loss/push is determined by grading the wager against the final score
  and the member's own line, not by comparing a picked team to the game winner.
- `result-resolution`: resolving a game requires final scores. Marking a winner alone is no
  longer sufficient to score a week.

## Impact

**Schema** — `picks` (rename + `bet_type`, `line`, `odds`), `pick_audit_log` (widened to
record the full before/after wager), new `grade_pick()` function, rewritten `resolve_game()`.
Adds the missing `picks(game_id)` and `picks(week_id)` indexes.

**API** — `POST /api/picks`, `PATCH /api/admin/games/[id]`, `POST /api/admin/picks/override`.

**UI** — `(member)/picks/PicksClient.tsx` (wager composer), `(admin)/results/ResultsClient.tsx`
(score entry), plus every surface that renders a pick as a team name: `(admin)/pick-grid`,
`(member)/leaderboard`, `(member)/stats/[memberId]`, `(member)/analytics`. A new
`src/lib/wagers.ts` replaces the `picked_team === "HOME" ? … : …` idiom currently
reimplemented inline in seven files.

**Not affected** — the LOTW rules, the forfeit rule, `close_week`, and `weekly_scores`.

**Supersedes** — `openspec/changes/betting-tracker/plans/sports-api-results.md:29`, which
scoped pre-game odds and spreads out.

**Deliberately deferred** — the -120 price rule; provider-sourced lines (CFBD's `/lines`
endpoint reaches spreads, totals and moneylines under the existing `CFBD_API_KEY` if
verification is ever wanted); reconciling the 648 rows of 2024 `bet_text` history, which
stays blocked on there being no 2024 games in the database.

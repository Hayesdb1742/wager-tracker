## 1. Schema

- [x] 1.1 `supabase migration new wager_types`
- [x] 1.2 Rename `picks.picked_team` → `picks.selection`, drop `picks_picked_team_check`
- [x] 1.3 Add `picks.bet_type text not null`, `picks.line numeric(5,1) not null`,
      `picks.odds int null` — **no defaults**, only possible while `picks` is empty
- [x] 1.4 Add the CHECK constraints: bet type domain, selection domain, selection-matches-type,
      `ML` line is 0, `TOTAL` line > 0, odds outside (-100, 100)
- [x] 1.5 Widen `pick_audit_log`: rename `previous_team`/`new_team` →
      `previous_selection`/`new_selection` with the 4-value check, add
      `previous_bet_type`/`new_bet_type`, `previous_line`/`new_line`,
      `previous_odds`/`new_odds`
- [x] 1.6 Add the missing `picks(game_id)` and `picks(week_id)` indexes
- [x] 1.7 Confirm `picks`, `pick_audit_log` and `weekly_scores` are still empty immediately
      before pushing, and that the live week 2 is still `CLOSED`

## 2. Grading

- [x] 2.1 Create `grade_pick(bet_type, selection, line, home_score, away_score)` returning
      `WIN|LOSS|PUSH`, `language sql immutable`
- [x] 2.2 Verify `grade_pick` against its full truth table by direct `SELECT`, before any
      application code depends on it: favourite covers / fails to cover / lands exactly on the
      number; underdog covers without winning; `ML` win, loss and tie; total over, under and
      exactly on the number
- [x] 2.3 Rewrite `resolve_game` to `resolve_game(p_game_id uuid, p_home_score int,
      p_away_score int)` — store scores, set FINAL, derive `games.winner` for display, grade
      every wager via `grade_pick`, apply ±1 / ±2 / 0
- [x] 2.4 Capture `resolve_game`'s existing grants before dropping it and re-grant exactly the
      same set afterwards (it is `security definer` and granted to `anon` — F1, accepted risk,
      must not change in either direction)
- [x] 2.5 `supabase db push`, then
      `supabase gen types typescript --linked > src/types/database.ts`

## 3. Shared formatting

- [x] 3.1 Create `src/lib/wagers.ts` with `formatWager(pick, game)` → `"Michigan -3.5"`,
      `"Over 52.5"`, `"Texas ML"`
- [x] 3.2 Add `formatMatchup(game)`, replacing the seven inline `away @ home` variants
- [x] 3.3 Add `wagerResult(points)` → `WIN | LOSS | PUSH | PENDING`, replacing the
      `points > 0 / < 0 / === 0` decode duplicated across six files; keep a cancelled game's
      zero distinguishable from a genuine push

## 4. API routes

- [x] 4.1 `POST /api/picks` — accept `{ game_id, bet_type, selection, line, odds? }` and
      validate the type/selection pairing, the line rules and the odds range, mirroring the
      CHECKs; keep `onConflict: "member_id,game_id"`
- [x] 4.2 `PATCH /api/admin/games/[id]` — replace the `winner` branch with a
      `home_score`/`away_score` branch calling the new `resolve_game`; reject a partial or
      negative score
- [x] 4.3 `POST /api/admin/picks/override` — accept the full wager shape and write the widened
      audit row
- [x] 4.4 Update `src/lib/sports/sync.ts` to pass both scores to `resolve_game` (it already
      holds them)

## 5. Member UI

- [x] 5.1 Replace `PicksClient.tsx`'s hardcoded `grid-cols-2` / `["AWAY","HOME"]` picker with
      a wager composer: bet-type control, then team buttons (`ML`), team buttons + signed line
      (`SPREAD`), or Over/Under + total (`TOTAL`), plus an optional price field
- [x] 5.2 Save only once the wager is complete and valid, debounced — a lone `-` or a trailing
      decimal point must not POST
- [x] 5.3 Render each saved wager back to the member via `formatWager`

## 6. Admin and display surfaces

- [x] 6.1 `(admin)/results/ResultsClient.tsx` — replace the HOME/AWAY/PUSH buttons with two
      score inputs; keep the "Correct result?" confirmation
- [x] 6.2 `(admin)/pick-grid/PicksAdminClient.tsx` — `pickLabel`, the cell tooltip, the
      override controls and the audit-log tab; cells need more width than a 3-char
      abbreviation
- [x] 6.3 `(member)/leaderboard/LeaderboardClient.tsx` — render via `formatWager`, and fix the
      pre-kickoff leak where the picked side is bolded from `pick?.picked_team` directly
      rather than the `showPick` gate
- [x] 6.4 `(member)/stats/[memberId]/page.tsx` and `(member)/analytics/page.tsx` — team
      bucketing and LOTW history
- [x] 6.5 Update `supabase/seeds/dev_seed.sql`, which inserts `picked_team` and re-implements
      the scoring `case` twice

## 7. Verify

- [x] 7.1 `npx next typegen && npx tsc --noEmit` — this is what surfaces the rename across
      every view file
- [x] 7.2 `npx eslint` and `npx next build`
- [ ] 7.3 End-to-end on week 2 (not week 1, which is spent): open the week, sign in via
      `/api/dev/magic-link`, enter one wager of each type, confirm the stored rows
- [x] 7.4 Resolve a week-2 game with real scores and assert `picks.points` and
      `weekly_scores.pick_points` match hand-computed values, including a deliberate push
- [x] 7.5 Re-run `POST /api/admin/sync-results` for week 21 and confirm the new signature
      resolves without error

## 8. Close out the docs

- [x] 8.1 Correct F3 in `docs/database-architecture-review.md`: 430 spreads not 292, **89
      totals not 1**, and mark it resolved with the chosen model
- [x] 8.2 Close W3 in `docs/database-remediation-backlog.md` — option (b) and then some: all
      three bet types, member-entered rather than provider-sourced
- [x] 8.3 Correct the W3.2 premise — `historical_picks` is read by no page, so the two eras
      are not currently being summed in one column
- [x] 8.4 Note that W12.4 (parsing `bet_text`) is unblocked in principle but still gated on
      populating `teams` (F4) and backfilling 2024 games, and that 84 LOTW rows carry no bet
      detail at all

> **Status 2026-09-08.** All tasks complete except **7.3**, the in-browser pass. The full
> stack was verified below the UI instead: `grade_pick` against a 14-case truth table, then
> six live wagers (one of every grade) through `resolve_game` on a real week-2 game,
> including a score correction that moved three members and left three unchanged. Test rows
> were deleted and the game restored to SCHEDULED. `tsc`, `eslint` and `next build` are
> clean, and `sync-results` re-resolved week 21 through the new signature (91/91 final, 0
> errors). What remains unexercised is the composer UI under a real member session.

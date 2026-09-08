# Database Remediation Backlog

Work items derived from [`database-architecture-review.md`](./database-architecture-review.md)
(reviewed 2026-09-04). Each item is self-contained: a cold session should be able to pick one
up without re-deriving context.

**Conventions**

- Items are `W1`…`W13`, ordered by priority. `F<n>` refs point back to review findings.
- Check items off in place (`- [x]`) and update the finding's status row in the review doc.
- Every schema change ships as a migration in `supabase/migrations/`, never as a raw
  `execute_sql` against production — see **W1**, which must land first.
- Verification queries assume the Supabase MCP tools (`mcp__supabase__execute_sql`).

**Wave summary**

| Wave | Theme | Items | Constraint |
|---|---|---|---|
| 0 | Prerequisite | ~~W1~~ ✅ | Cleared 2026-09-04 — no longer blocking |
| 1 | Urgent — before week 1 closes | ~~W2~~ (deferred), ~~W3~~ ✅, ~~W4~~ ⏸️ tabled | Deadline passed — nothing live |
| 2 | Structural — while `picks` is empty | W5, W6, W7 (partial), W8 | Cost rises once picks land |
| 3 | Correctness & hygiene | W9–W13 | No hard deadline |

> **Progress note, 2026-09-04 (go-live day).** W1 is done, W7.3/W7.5 and W12.2 landed, and
> pool week 1 opened for real. **W2 and W8 are deliberately deferred** — Hayes reviewed F1
> and F2 and accepted them as known risk on a private ~8-person league. They are not to be
> re-raised as urgent; revisit if this deploys publicly.
>
> That leaves **W3 and W4 as the live Wave 1 items** against the 2026-09-08 deadline, both of
> which need Hayes' input (see the Decision Register). `picks` is still empty, so the Wave 2
> window is open but closing — members can submit as soon as they log in.
>
> **Update, 2026-09-08 (deadline day).** **W3 is done** — see below; it shipped as all three
> bet types with member-entered lines, and it took W5's two missing `picks` indexes with it.
> `picks`, `pick_audit_log` and `weekly_scores` were **still at zero rows** when the
> migration ran, so it was a column add rather than a data migration. That window has now
> closed for practical purposes: week 2 is the first week members can enter wagers.
> **W4 (per-sport forfeits) is the last open Wave 1 item** and Hayes is taking it separately.
>
> **Update, later on 2026-09-08.** **Week 1 closed and week 2 opened.** Week 1 was closed
> with a direct `UPDATE`, deliberately **not** `close_week(21)` — it had zero picks by
> design as a functional test, and the RPC would have booked -5 forfeit + -1 LOTW against
> all 8 members for a week nobody was asked to play. Week 2 (`weeks.id = 22`, 102 games,
> 5 CFB + 4 NFL) is now the single open week. **W4 is tabled** at Hayes' direction, so Wave
> 1 has no live items; see the exposure note under W4.

---

## Wave 0 — Prerequisite

### W1. Reconcile migration drift ✅

**Finding:** F14 · **Size:** S · **Blocks:** every other item in this backlog
**Status: done 2026-09-04** (`bd3e712`), except 1.4. Wave 0 no longer blocks.

The database has six applied migrations; `supabase/migrations/` contains five files. The
applied-but-unversioned one is `20260725173415_seasons_allow_multiple_per_year`. Any rebuild
from migrations produces a schema that differs from production, and every migration written
after this point inherits the divergence.

- [x] 1.1 List applied migrations (`mcp__supabase__list_migrations`) and diff against
      `/bin/ls supabase/migrations/`
- [x] 1.2 ~~Reconstruct the missing migration's DDL from live state.~~ **Not needed —
      recovered verbatim.** Supabase retains the executed SQL in
      `supabase_migrations.schema_migrations.statements`; querying that column returned the
      original file including its comments. Always try this before reconstructing by hand.
- [x] 1.3 Write `supabase/migrations/20260725173415_seasons_allow_multiple_per_year.sql` to
      match — written verbatim from the recovered statement rather than idempotently, since
      it is a faithful copy of what actually ran
- [ ] 1.4 Add a `supabase db diff` (or equivalent) check to the workflow so drift is caught
      at the point it is introduced — **still open**, and the one thing that would have
      caught the drift below

> **Gotcha found while doing this.** `mcp__supabase__apply_migration` assigns its own
> timestamp, which will not match a locally-authored filename. The `active_season_flag`
> migration was written as `20260904235500_*` but recorded remotely as `20260905002358_*`,
> creating fresh drift within the same session as the fix. The local file was renamed to
> match. Whatever lands for 1.4 should catch filename-vs-version mismatch, not just
> missing files.

**Acceptance:** ✅ applied-migration list and `supabase/migrations/` contents match exactly
(seven versions, verified 2026-09-04); a fresh `supabase db reset` reproduces production's
`public` schema.

---

## Wave 1 — Before week 1 closes (2026-09-08)

### W2. Revoke public EXECUTE on the SECURITY DEFINER RPCs ✅

**Finding:** F1 (🔴 Critical) · **Size:** S · **Depends on:** W1
**Status: done 2026-09-08**, in two migrations — see the PUBLIC gotcha below.

`resolve_game`, `close_week`, `handle_new_user`, and `rls_auto_enable` are `SECURITY
DEFINER` and carry `EXECUTE` for `anon` and `authenticated`. The anon key ships to the
browser, so anyone holding it can call `POST /rest/v1/rpc/resolve_game` with any game and
any winner, rewriting results and every member's score. The app only ever calls these
through the service-role client, so nothing legitimate depends on the grants.

- [x] 2.1 Write a migration revoking the grants —
      `20260908202846_revoke_public_rpc_execute.sql`, then
      `20260908203026_revoke_public_rpc_execute_from_public.sql`
- [x] 2.2 Pin `search_path` on the functions missing it. Done for `resolve_game`,
      `close_week`, `custom_access_token_hook` **and `grade_pick`** (the linter flagged
      four, not three). No body needed re-qualifying — all four already schema-qualify
      every identifier, so `search_path = ''` was a runtime no-op.
- [x] 2.3 Add a defensive guard as the first statement of `resolve_game` and `close_week`.
      Written as `if auth.role() is not null and auth.role() <> 'service_role'` — the
      null arm matters, because `auth.role()` is null on a direct database connection
      (psql, `supabase db push`, the MCP tool), and a bare `<>` check would lock migrations
      and admin SQL out of the functions.
- [x] 2.4 Regression-check the four callers still work — all four use `createAdminClient()`
      (service role), verified at `api/admin/picks/override/route.ts:97`,
      `api/admin/weeks/[id]/close/route.ts:38`, `api/admin/games/[id]/route.ts:74`,
      `lib/sports/sync.ts:154`. Exercised over live PostgREST: anon → both RPCs return
      `401 / 42501 permission denied`; service_role → `resolve_game` on a nonexistent
      game id returns `204` (no-op). `custom_access_token_hook` still resolves ADMIN and
      MEMBER correctly after the `search_path` change.

> **Gotcha: revoking from `anon, authenticated` is not enough.** Postgres grants `EXECUTE`
> to `PUBLIC` by default on every function, and `anon`/`authenticated` inherit through it.
> After the first migration the advisor still reported both
> `*_security_definer_function_executable` lints. The real fix is
> `revoke execute on function … from public`.
>
> **The verify query below was wrong in the same way** and is corrected here: filtering on
> `pg_get_userbyid(ac.grantee) in ('anon','authenticated')` never matches the PUBLIC entry,
> which is grantee **OID 0** and renders as `unknown (OID=0)`. The original query returned
> zero rows — a clean bill of health — while the grant was still live.

**Acceptance:** ✅ `mcp__supabase__get_advisors({type:"security"})` reports neither
`anon_security_definer_function_executable` nor
`authenticated_security_definer_function_executable`, and `function_search_path_mutable`
is clear. Only `auth_leaked_password_protection` remains, which does not apply to a
magic-link-only app.

**Verify:**
```sql
select p.proname,
       coalesce(nullif(pg_get_userbyid(ac.grantee), ''), 'PUBLIC') as grantee,
       ac.grantee as grantee_oid,
       ac.privilege_type
from pg_proc p, aclexplode(p.proacl) ac
where p.pronamespace = 'public'::regnamespace
  and p.proname in ('resolve_game','close_week','handle_new_user','rls_auto_enable')
  and (ac.grantee = 0 or pg_get_userbyid(ac.grantee) in ('anon','authenticated'));
-- expect: zero rows (grantee 0 is PUBLIC)
```

---

### W3. Confirm the scoring model: straight-up vs. against-the-spread ✅

**Finding:** F3 · **Size:** S to decide, L if ATS is chosen · **Type:** decision, not code
**Status: done 2026-09-08** — decided **(b)**, and wider than the two options below.

The spec deliberately chose straight-up picking (`proposal.md`: "select a team for each
game", "+1 win / 0 push / -1 loss"; "spread" appears in no spec file). But 292 of 648
historical picks carry a point spread and 26 are moneylines — the league bet ATS in 2024.
Both facts are true; the gap between them was never written down.

- [x] 3.1 Put the choice to the league explicitly. Two viable paths:
      - **(a) Accept the break.** Keep straight-up. Cheap, honest, no schema change.
        Requires W3.2.
        Consequence: 2024 and 2026 records are different metrics and must never be summed.
      - **(b) Model the spread.** Add `games.spread numeric(4,1)` + `spread_source text`,
        add a `PUSH` path to `resolve_game` when margin equals spread, source lines from an
        odds provider. Preserves continuity with league history; unblocks W12.
- [x] 3.2 ~~If (a): label the eras distinctly~~ — **moot, (b) was chosen.** Also note the
      premise was wrong: `historical_picks` is read by **no page**, so the eras were never
      actually being summed in one column. See the note below.
- [x] 3.2b (a) is not in play; the original text follows for the record —
      `(member)/analytics/page.tsx`, `(member)/stats/[memberId]/page.tsx`. All-time
      standings, win %, and LOTW records currently span both eras in one column, which
      misrepresents both.
- [x] 3.3 If (b): schedule before week 1 closes. **Landed 2026-09-08 with `picks` still at
      zero rows**, so it was a column add, not a data migration.
- [x] 3.4 Record the decision and its rationale in `design.md`, and update the F3 status row
      in the review doc — recorded in `openspec/changes/wager-types/design.md`; F3 marked
      Resolved and its bet-shape counts corrected

> **What shipped, 2026-09-08.** Not (a) or (b) as framed, but (b) widened: **all three bet
> types the history contains** — `ML`, `SPREAD`, `TOTAL` — with the line **on the pick and
> entered by the member**, not a provider-sourced column on `games`. Two members may hold
> different numbers on the same game and be graded differently from one final score.
>
> `supabase/migrations/20260908195803_wager_types.sql`: `picks.picked_team` → `selection`
> (widened to `HOME|AWAY|OVER|UNDER`), plus `bet_type`, `line`, `odds`, six CHECK
> constraints, and the two missing indexes from W5. New `grade_pick()`; `resolve_game`
> rewritten to `(game_id, home_score, away_score)` — a spread cannot be graded from "HOME
> won", so the admin results screen now captures scores. Specs in
> `openspec/changes/wager-types/`.
>
> **Correction to this item's premise.** F3 said the history held "one total". It holds
> **89**. It also undercounted spreads at 292 by missing 138 unsigned rows (`"Bears 1.5"`);
> the real figure is 430. Totals were the third-largest shape in league history and the
> backlog was arguing about whether to support spreads while over/unders sat unnoticed in
> the same column. Match totals *before* spreads when parsing, or `"Chiefs Raider U45.5"`
> reads as a spread.
>
> **Deliberately not done:** the -120 price rule (`odds` is stored and range-checked as a
> plausible American price, nothing more), and any verification of member-entered lines.
> CFBD's `/lines` endpoint would supply spreads, totals and moneylines under the existing
> `CFBD_API_KEY`, keyed by the `external_id` already on `games`, if that is ever wanted.

**Acceptance:** ✅ decision recorded in `openspec/changes/wager-types/design.md`; the two
eras are scored on a comparable basis from 2026 onward (both ATS-capable), and the analytics
surface was never in fact mixing them — it does not read `historical_picks` at all.

---

### W4. Make forfeit penalties split-aware ⏸️

**Finding:** F6 · **Size:** M · **Depends on:** W1
**Status: tabled 2026-09-08** by Hayes, to be picked up later. It is no longer a Wave 1
deadline item.

> **What tabling costs.** Week 2 opened 2026-09-08 as a **5 CFB + 4 NFL** week — the first
> split week the league has actually played, and 16 of 19 weeks in this season carry a
> split. Until this lands, `close_week` reads `required_picks` alone, so a member who
> submits 9 CFB picks and no NFL picks incurs **no penalty at all**. The exposure is real
> from week 2 onward but it is not silent damage: `weekly_scores` is still empty, and
> forfeits are only computed at week close. So the deadline that matters is **the first time
> a split week is closed**, not the first time one opens. Decide 4.2 before then.

`close_week` computes forfeits from `required_picks` alone:
`v_forfeit := greatest(0, v_required_picks - v_pick_count) * -1`. Migration
`20260725145656_week_sport_pick_split` added `required_cfb_picks` / `required_nfl_picks` but
never updated the function. In a 5 CFB + 4 NFL week, a member submitting 9 CFB picks incurs
no penalty. 16 of 19 weeks in season 3 carry a split, so this is the normal case.

- [ ] 4.1 Rewrite the forfeit calculation to penalise per-sport shortfall when the split is
      present, falling back to the untyped total when both split columns are NULL (weeks 0
      and 15 — see W13.4). Joining `picks → games` for `sport` is required; `picks` has no
      sport column.
- [ ] 4.2 Confirm the intended rule with Hayes before implementing: is a 9-CFB submission in
      a 5+4 week worth `-4` (missed all four NFL slots) or something else? The spec's
      forfeit rule (`-1` per unpicked slot) does not address per-sport shortfall.
- [ ] 4.3 Add the pick-entry–side guard: `POST /api/picks` should reject or warn when a
      submission violates the split, so members are not silently accruing penalties
- [ ] 4.4 Backfill check — no weeks have been scored under the split yet
      (`weekly_scores` is empty, re-confirmed 2026-09-08), so no historical correction is
      needed. Re-confirm before assuming; this stops being true once any week is closed.

**Acceptance:** a member with 9 CFB picks in a 5 CFB + 4 NFL week receives the agreed
non-zero penalty; a member with 5 CFB + 4 NFL receives zero; NULL-split weeks behave exactly
as they do today.

---

## Wave 2 — While `picks` is still empty

> These items are all substantially cheaper before members submit picks. `picks` and
> `weekly_scores` currently hold zero rows.

### W5. Add the eight missing foreign-key indexes

**Finding:** F10 · **Size:** S · **Depends on:** W1

`games.week_id`, `picks.game_id`, `picks.week_id`, `picks.overridden_by`,
`weekly_scores.week_id`, `pick_audit_log.pick_id`, `pick_audit_log.changed_by`,
`invites.invited_by`. `games.week_id` matters immediately — 1,110 rows and every page filters
by week.

- [ ] 5.1 Single migration creating all eight indexes — **2 of 8 done 2026-09-08**:
      `picks.game_id` and `picks.week_id` shipped with the W3 wager-types migration, since
      grading now fans out per game. Six remain: `games.week_id` (the one that matters most),
      `picks.overridden_by`, `weekly_scores.week_id`, `pick_audit_log.pick_id`,
      `pick_audit_log.changed_by`, `invites.invited_by`.
- [ ] 5.2 Drop `historical_picks_season_week_idx` if still unused, or note why it is retained
      (advisor reports it as never used)

**Acceptance:** `mcp__supabase__get_advisors({type:"performance"})` reports zero
`unindexed_foreign_keys`.

---

### W6. Normalize team identity; populate the `teams` table

**Finding:** F4 · **Size:** L · **Depends on:** W1, W5

`games.home_team` / `away_team` are free text — 288 distinct strings across 1,110 games, with
no FK. `teams` exists with exactly the right shape (`name UNIQUE`, `abbreviation`, `sport`,
`external_id`) and holds **zero rows and zero code references**. The team-tendencies features
(tasks 15.3 / 15.4, both marked complete) are built on string equality over this column.

- [ ] 6.1 Populate `teams` from the ESPN/CFBD provider payloads in `src/lib/sports/`, keying
      on the provider's team id → `teams.external_id`
- [ ] 6.2 Add a `team_aliases` table (`team_id`, `alias`, `source`) to absorb provider naming
      differences and the misspellings in `historical_picks.bet_text` (`"Seahwaks"`,
      `"Benagls"`, `"Vtech"`, `"cheifs"`)
- [ ] 6.3 Add `games.home_team_id` / `away_team_id` as nullable FKs; backfill from the
      existing text columns via `teams.name` + aliases; report any unmatched strings rather
      than silently dropping them
- [ ] 6.4 Once backfill is clean, set the FK columns `not null` and drop the text columns
      (or retain them as `*_raw` for provenance — decide and note which)
- [ ] 6.5 Update the sync path to write team FKs, and the team-tendency queries in
      `(member)/analytics/page.tsx` and `(member)/stats/[memberId]/page.tsx` to join on them
- [ ] 6.6 Regenerate `src/types/database.ts`

**Acceptance:** every `games` row resolves to two `teams` rows; team-tendency queries join on
FK rather than string equality; zero unmatched names in the backfill report.

---

### W7. Give `weeks.status` three states and enforce one open week

**Finding:** F7 · **Size:** M · **Depends on:** W1
**Status: partial.** 7.3 and 7.5 landed 2026-09-04; the `weeks.status` domain work
(7.1, 7.2, 7.4, 7.6, 7.7) is untouched and remains the substance of this item.

`status` is `OPEN|CLOSED`, but three states are in use: weeks 2–18 of season 3 are `CLOSED`
meaning *"hasn't happened yet"* while week 0 is `CLOSED` meaning *"finished and scored"*.
`close_week()` applies forfeit penalties — run it on a future week and the whole league is
penalised for games that have not kicked off. Separately, nothing constrains the number of
`OPEN` weeks, and `/api/admin/weeks/[id]/reopen` creates a second one by design.

- [ ] 7.1 Migrate the domain to `UPCOMING | OPEN | SCORED`; backfill correctly — a `CLOSED`
      week with a `weekly_scores` row (or with all games FINAL) is `SCORED`, otherwise
      `UPCOMING`. Season 3 weeks 2–18 all become `UPCOMING`; week 0 becomes `SCORED`.
- [ ] 7.2 Add `create unique index weeks_one_open_per_season on weeks (season_id)
      where status = 'OPEN';`
- [x] 7.3 ~~Add `seasons.is_current boolean`~~ **Done 2026-09-04** (`82f7557`) as
      `seasons.is_active`, with partial unique index `seasons_one_active_idx`. Season 3
      flagged. Note the name differs from what this item specified.
- [ ] 7.4 Update every call site that compares against the old values —
      `(member)/picks/page.tsx:17`, `(member)/leaderboard/page.tsx:14`,
      `(member)/leaderboard/LeaderboardClient.tsx:174,178`,
      `(admin)/pick-grid/page.tsx:20`, `(admin)/results/page.tsx:31`,
      `(admin)/weeks/WeeksClient.tsx:99,289,298`, `api/admin/weeks/[id]/reopen/route.ts:21`
- [x] 7.5 ~~Replace `weeks.find(w => w.status === 'OPEN')` with a lookup scoped to the
      current season~~ **Done 2026-09-04** (`82f7557`). `getActiveSeasonId()` in
      `src/lib/seasons.ts` is the shared accessor; all five call sites scope through it.
      The admin weeks page also had a related bug — it identified the season by matching
      `seasons.year` against the calendar year, which is ambiguous because "2026 Season" and
      "2026 NFL Preseason" share year 2026. Verified by planting a stale OPEN week with a
      higher `week_number` in an inactive season; `/picks` continued to serve pool week 1.
- [ ] 7.6 Guard `close_week` against being run on an `UPCOMING` week
- [ ] 7.7 Regenerate `src/types/database.ts`

**Acceptance:** at most one `OPEN` week per season is representable; `close_week` on a future
week raises rather than penalising; "current week" resolution is deterministic.

---

### W8. Decide and enforce the authorization model

**Finding:** F2 (🔴 Critical) · **Size:** L · **Depends on:** W2

`src/lib/supabase/admin.ts` (service role, bypasses RLS unconditionally) is imported by 27
files including member-facing pages. So 22 RLS policies never execute, and all authorization
lives in route-handler code. The `picks_own_read` + `picks_post_kickoff_read` policies encode
blind-pick enforcement — a load-bearing league rule, and capability `pick-visibility` in the
spec — and they are inert.

- [ ] 8.1 **Decide explicitly** (needs Hayes) between:
      - **(a) RLS-enforced.** Move member-facing reads onto the anon/user client so policies
        actually run. Restores a database-level backstop; prerequisite for W10.
      - **(b) Server-authz.** Keep service-role everywhere and **delete the policies**, so
        nobody is misled into thinking they protect anything.
      Path (a) is the recommendation: the blind-pick rule is exactly the kind of invariant
      worth enforcing below the application.
- [ ] 8.2 Audit the current blind-pick enforcement either way. Confirm by test that
      `/pick-grid` and the leaderboard do not expose pre-kickoff picks today — with RLS
      inert, only a hand-written filter stands between members and each other's picks.
- [ ] 8.3 If (a): convert `(member)/picks`, `(member)/leaderboard`, `(member)/stats/[memberId]`,
      `(member)/analytics` to the user-scoped client; keep service role for `(admin)` routes
      and `lib/sports/sync.ts`
- [ ] 8.4 If (a): fix the policy set while touching it — see W11.3
- [ ] 8.5 Add a test asserting a non-admin member cannot read another member's pre-kickoff
      pick, whichever path is chosen

**Acceptance:** the enforcement layer is a documented, deliberate choice; an automated test
covers the blind-pick rule.

---

## Wave 3 — Correctness & hygiene

### W9. Make `weekly_scores` self-consistent

**Finding:** F8 · **Size:** M · **Depends on:** W4, W7

`weekly_scores` is a cache maintained only by `resolve_game` and `close_week`. No triggers on
`picks`. Insert, update, or delete a pick after its game resolved — or un-resolve a game —
and the score drifts silently. `/api/admin/picks/override:80` calls `resolve_game` afterward
by convention, which one future route will forget.

- [ ] 9.1 Choose the fix: (a) trigger on `picks` recomputing the affected member/week, or
      (b) make `pick_points` a view over `picks` and keep `weekly_scores` for penalties only.
      (b) is structurally cleaner and removes a whole class of drift.
- [ ] 9.2 Implement, preserving the generated `total` semantics
- [ ] 9.3 Add a reconciliation query to this doc that recomputes scores from `picks` and
      diffs against `weekly_scores` — cheap standing safety net regardless of which fix lands

**Acceptance:** mutating a pick on a resolved game updates the member's score without an
explicit `resolve_game` call; the reconciliation query returns zero rows.

---

### W10. Fix the dead realtime leaderboard

**Finding:** F9 · **Size:** S · **Depends on:** W8

`LeaderboardClient.tsx:79-82` subscribes to `postgres_changes` on `public.weekly_scores`. The
`supabase_realtime` publication contains **zero public tables** — the channel connects and no
event ever arrives. Task 14.2 is marked complete but is non-functional.

- [ ] 10.1 `alter publication supabase_realtime add table public.weekly_scores;`
- [ ] 10.2 Confirm delivery reaches an anon-key client. A table written via service role will
      not broadcast to a client subject to RLS, so this depends on the W8 outcome — if W8
      lands on (b), realtime needs a different mechanism (broadcast, or polling).
- [ ] 10.3 Verify end-to-end: resolve a game in one browser, observe the leaderboard update
      in another without refresh
- [ ] 10.4 Re-open task 14.2 in `openspec/changes/betting-tracker/tasks.md` until verified

**Acceptance:** a resolved game visibly updates a second browser's leaderboard.

**Verify:**
```sql
select * from pg_publication_tables where pubname = 'supabase_realtime';
-- expect: public.weekly_scores present
```

---

### W11. Audit-trail and policy cleanup

**Findings:** F11, F12, F13 · **Size:** M · **Depends on:** W1

- [ ] 11.1 Resolve the duplicate override audit trail (F12): `picks.overridden_by` /
      `overridden_at` and `pick_audit_log` both exist; only the latter is written
      (`api/admin/picks/override/route.ts:56`). Either drop the columns or populate them —
      note that `(member)` pick sheets are specced (task 12.4) to show "Modified by admin —
      [timestamp]", which needs one of them to be reliable.
- [ ] 11.2 Add an `updated_at` trigger on `picks` (F13). No trigger and no application write
      exists, so the column permanently equals `created_at` and will lie in any audit query.
- [ ] 11.3 Fix RLS hygiene (F11) — 62 advisor warnings:
      - 18 × `auth_rls_initplan`: wrap as `(select auth.uid())` / `(select auth.role())`
      - 44 × `multiple_permissive_policies`: the `FOR ALL` admin policies stack onto every
        SELECT; split into explicit per-command policies
      - retarget policies from role `public` to `authenticated` so they stop being evaluated
        for `anon`

**Acceptance:** one audit mechanism remains and is populated; `updated_at` advances on
update; performance advisor is clear of `auth_rls_initplan` and
`multiple_permissive_policies`.

---

### W12. Integrate `historical_picks` with the live model

**Finding:** F5 · **Size:** L · **Depends on:** W3 (decision), W6 (teams + aliases)

648 picks from 2024, joined to `seasons` by `season_year int` and to weeks by
`week_number int` — convention only, no FKs. `result` is `'Win'|'Lose'|'Push'` against the
live model's `picked_team HOME|AWAY` + `points int`. Two vocabularies, no bridging view, so
every analytics page special-cases history.

- [ ] 12.1 Add real FKs: `historical_picks.season_id → seasons.id`, and `week_id → weeks.id`
      where a matching week exists. Season 2 ("2024 Season") is a 14-week stub with zero
      games — decide whether to populate its schedule or leave history week-linked only.
- [x] 12.2 ~~Reconcile the 6 distinct `display_name` values against 8 profiles~~
      **Done 2026-09-04.** The roster was rebuilt that day — 9 synthetic seed profiles
      deleted, 8 real members created — and all 648 historical picks now carry a populated
      `member_id`, matched on `display_name`. Nobody is unmapped: Griffin and Andrew are
      new to the pool and simply have no 2024 record.
- [ ] 12.3 Create a bridging view exposing both eras in one shape, so analytics pages stop
      special-casing. Honour the W3 decision: if the eras are not comparable, the view must
      carry an era discriminator rather than flattening them.
- [ ] 12.4 Parse `bet_text` into structured picks — **W3 no longer blocks this** (2026-09-08:
      (b) shipped, so `ML`/`SPREAD`/`TOTAL` all have somewhere to land). It is still gated on
      three prerequisites, none of which are W3:
      - `teams` + an alias table (**W11 / F4**) — the history spells them `Seahwaks`,
        `Cheifs`, `Arkansaw`, `Viilanova`; ~40 misspellings need to resolve
      - **2024 games must be backfilled** — the database holds none, so a perfect parser has
        nothing to join to. CFBD `/games?year=2024` and ESPN reach them with existing keys
      - 2024 closing lines, to recover the **138 unsigned spreads** (`"Bears 1.5"` — the
        number survives, the side does not). CFBD `/lines?year=2024` covers CFB; NFL has no
        free source in the current stack
      Ceiling even then: **84 LOTW rows carry no bet detail at all** (`bet_text` is the
      literal string `LOTW`) and 19 are team-only. ~16% of the history is unrecoverable
      regardless of effort — worth stating in the acceptance rather than chasing.

**Acceptance:** history joins to `seasons`/`weeks` by FK; analytics reads one shape; the
`bet_text` question is either resolved or formally closed with a reason.

---

### W13. Hygiene batch

**Findings:** F15, F16, F17, F18, F19 · **Size:** M · **Depends on:** W1

Independent small items; can be picked up individually.

- [ ] 13.1 (F15) Quarantine test-season residue. Season 1 ("2025 Season", 5 weeks, 16 games,
      10 FINAL) and season 4 ("2026 NFL Preseason") are indistinguishable from real seasons
      to `analytics/page.tsx:33`, which lists all seasons unfiltered. Delete them, or add a
      flag and filter. Confirm with Hayes before deleting — season 4 may be intentional.
      **Partial 2026-09-04:** the flag half exists — `seasons.is_active` marks season 3 and
      week resolution respects it, so a stale season can no longer supply the current week.
      Season 1's seed picks and `weekly_scores` were deleted with the seed profiles. Still
      to do: filter `analytics/page.tsx:33`, and decide delete-vs-retain.
- [ ] 13.2 (F16) `invites`: add a unique constraint on `email` (`citext` or a functional
      unique index on `lower(email)`), and a link from invite to the profile it produced
- [ ] 13.3 (F17) Constrain the penalty columns:
      ```sql
      alter table weekly_scores
        add constraint weekly_scores_forfeit_nonpositive check (forfeit_penalty <= 0),
        add constraint weekly_scores_lotw_nonpositive    check (lotw_penalty <= 0);
      ```
- [ ] 13.4 (F18) Close the schedule gaps: zero CFB games in pool weeks 13–18, weeks 19–21
      (postseason) absent, weeks 0 and 15 have NULL pick splits. The NULL splits interact
      with W4 — resolve them together.
- [ ] 13.5 (F19) Align `historical_picks.result` casing (`'Win'|'Lose'|'Push'`) with the
      UPPER convention used by every other vocabulary, or document the exception

**Acceptance:** advisors clean; no test seasons surface in member-facing analytics; the
schedule gaps are filled or documented as intentional.

---

## Decision Register

Items needing Hayes' input before implementation. Record answers here as they land.

| Item | Question | Status |
|---|---|---|
| W3.1 | Straight-up or against-the-spread for 2026 onward? | ✅ Resolved 2026-09-08 — **both, plus totals**: `ML`/`SPREAD`/`TOTAL`, line entered by the member |
| W4.2 | What is the forfeit penalty for a per-sport shortfall? | Open — moot for week 1 (CFB-only, no split) |
| W8.1 | RLS-enforced reads, or server-authz with policies deleted? | **Deferred 2026-09-05** — F1/F2 accepted as known risk |
| W13.1 | Delete the 2025 test season and 2026 preseason, or flag and filter? | Partly answered — flagged via `is_active`; delete-vs-retain still open |

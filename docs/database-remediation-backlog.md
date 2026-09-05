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
| 0 | Prerequisite | W1 | Blocks all other migrations |
| 1 | Urgent — before week 1 closes | W2, W3, W4 | Deadline **2026-09-08** |
| 2 | Structural — while `picks` is empty | W5, W6, W7, W8 | Cost rises once picks land |
| 3 | Correctness & hygiene | W9–W13 | No hard deadline |

---

## Wave 0 — Prerequisite

### W1. Reconcile migration drift

**Finding:** F14 · **Size:** S · **Blocks:** every other item in this backlog

The database has six applied migrations; `supabase/migrations/` contains five files. The
applied-but-unversioned one is `20260725173415_seasons_allow_multiple_per_year`. Any rebuild
from migrations produces a schema that differs from production, and every migration written
after this point inherits the divergence.

- [ ] 1.1 List applied migrations (`mcp__supabase__list_migrations`) and diff against
      `/bin/ls supabase/migrations/`
- [ ] 1.2 Reconstruct the missing migration's DDL from live state. It relates to the
      `seasons` unique constraint — production currently has
      `seasons_year_name_key UNIQUE (year, name)`, which permits multiple seasons per year
      (e.g. "2026 Season" and "2026 NFL Preseason" both exist). Confirm with
      `pg_get_constraintdef` before writing.
- [ ] 1.3 Write `supabase/migrations/20260725173415_seasons_allow_multiple_per_year.sql` to
      match, idempotently (`drop constraint if exists` / `add constraint`)
- [ ] 1.4 Add a `supabase db diff` (or equivalent) check to the workflow so drift is caught
      at the point it is introduced

**Acceptance:** applied-migration list and `supabase/migrations/` contents match exactly;
a fresh `supabase db reset` reproduces production's `public` schema.

---

## Wave 1 — Before week 1 closes (2026-09-08)

### W2. Revoke public EXECUTE on the SECURITY DEFINER RPCs

**Finding:** F1 (🔴 Critical) · **Size:** S · **Depends on:** W1

`resolve_game`, `close_week`, `handle_new_user`, and `rls_auto_enable` are `SECURITY
DEFINER` and carry `EXECUTE` for `anon` and `authenticated`. The anon key ships to the
browser, so anyone holding it can call `POST /rest/v1/rpc/resolve_game` with any game and
any winner, rewriting results and every member's score. The app only ever calls these
through the service-role client, so nothing legitimate depends on the grants.

- [ ] 2.1 Write a migration revoking the grants:
      ```sql
      revoke execute on function public.resolve_game(uuid, text)  from anon, authenticated;
      revoke execute on function public.close_week(integer)       from anon, authenticated;
      revoke execute on function public.handle_new_user()         from anon, authenticated;
      revoke execute on function public.rls_auto_enable()         from anon, authenticated;
      ```
- [ ] 2.2 Pin `search_path` on the three functions missing it (`resolve_game`, `close_week`,
      `custom_access_token_hook`) — `alter function … set search_path = ''`, then
      schema-qualify every identifier in the body. `handle_new_user` already does this
      correctly; copy its pattern.
- [ ] 2.3 Add a defensive guard as the first statement of `resolve_game` and `close_week`:
      `if auth.role() <> 'service_role' then raise exception 'forbidden'; end if;` — defence
      in depth, so a future `grant` cannot silently re-open the hole
- [ ] 2.4 Regression-check the four callers still work:
      `api/admin/picks/override/route.ts:80`, `api/admin/weeks/[id]/close/route.ts:38`,
      `api/admin/games/[id]/route.ts:65`, `lib/sports/sync.ts:154`

**Acceptance:** `mcp__supabase__get_advisors({type:"security"})` no longer reports
`anon_security_definer_function_executable` or `authenticated_security_definer_function_executable`
for these functions; `function_search_path_mutable` is clear; admin close/resolve flows pass.

**Verify:**
```sql
select p.proname, pg_get_userbyid(ac.grantee) as grantee, ac.privilege_type
from pg_proc p, aclexplode(p.proacl) ac
where p.pronamespace = 'public'::regnamespace
  and pg_get_userbyid(ac.grantee) in ('anon','authenticated');
-- expect: zero rows
```

---

### W3. Confirm the scoring model: straight-up vs. against-the-spread

**Finding:** F3 · **Size:** S to decide, L if ATS is chosen · **Type:** decision, not code

This is a **decision item and needs Hayes' input** — do not resolve it by inference.

The spec deliberately chose straight-up picking (`proposal.md`: "select a team for each
game", "+1 win / 0 push / -1 loss"; "spread" appears in no spec file). But 292 of 648
historical picks carry a point spread and 26 are moneylines — the league bet ATS in 2024.
Both facts are true; the gap between them was never written down.

- [ ] 3.1 Put the choice to the league explicitly. Two viable paths:
      - **(a) Accept the break.** Keep straight-up. Cheap, honest, no schema change.
        Requires W3.2.
        Consequence: 2024 and 2026 records are different metrics and must never be summed.
      - **(b) Model the spread.** Add `games.spread numeric(4,1)` + `spread_source text`,
        add a `PUSH` path to `resolve_game` when margin equals spread, source lines from an
        odds provider. Preserves continuity with league history; unblocks W12.
- [ ] 3.2 If (a): label the eras distinctly wherever both are shown —
      `(member)/analytics/page.tsx`, `(member)/stats/[memberId]/page.tsx`. All-time
      standings, win %, and LOTW records currently span both eras in one column, which
      misrepresents both.
- [ ] 3.3 If (b): schedule before week 1 closes. Once picks land, this becomes a data
      migration rather than a column add.
- [ ] 3.4 Record the decision and its rationale in `design.md`, and update the F3 status row
      in the review doc

**Acceptance:** decision recorded in `design.md`; the analytics surface either labels the
eras or scores them on one comparable basis.

---

### W4. Make forfeit penalties split-aware

**Finding:** F6 · **Size:** M · **Depends on:** W1

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
      (`weekly_scores` is empty), so no historical correction is needed. Confirm before
      assuming.

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

- [ ] 5.1 Single migration creating all eight indexes
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
- [ ] 7.3 Add `seasons.is_current boolean` + partial unique index, and stop inferring the
      current season from whichever week happens to be open
- [ ] 7.4 Update every call site that compares against the old values —
      `(member)/picks/page.tsx:17`, `(member)/leaderboard/page.tsx:14`,
      `(member)/leaderboard/LeaderboardClient.tsx:174,178`,
      `(admin)/pick-grid/page.tsx:20`, `(admin)/results/page.tsx:31`,
      `(admin)/weeks/WeeksClient.tsx:99,289,298`, `api/admin/weeks/[id]/reopen/route.ts:21`
- [ ] 7.5 Replace `weeks.find(w => w.status === 'OPEN')` with a lookup scoped to the current
      season, so the result is deterministic rather than dependent on array order
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
- [ ] 12.2 Reconcile the 6 distinct `display_name` values against 8 profiles; document who
      is unmapped and why (two members with no 2024 record, or two unmapped names)
- [ ] 12.3 Create a bridging view exposing both eras in one shape, so analytics pages stop
      special-casing. Honour the W3 decision: if the eras are not comparable, the view must
      carry an era discriminator rather than flattening them.
- [ ] 12.4 Parse `bet_text` into structured picks — **blocked on W3(b)**. If the league stays
      straight-up, spread bets cannot be reconciled to `games` and this stays permanently out
      of scope; say so explicitly and close the item.

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
| W3.1 | Straight-up or against-the-spread for 2026 onward? | Open |
| W4.2 | What is the forfeit penalty for a per-sport shortfall? | Open |
| W8.1 | RLS-enforced reads, or server-authz with policies deleted? | Open |
| W13.1 | Delete the 2025 test season and 2026 preseason, or flag and filter? | Open |

# Database Architecture Review

**Reviewed:** 2026-09-04 · **Against:** live Supabase project (`public` schema) · **Status:** open

A standing architectural assessment of the betting-tracker database. Findings carry stable
IDs (`F1`…`F19`) so they can be referenced from commits, issues, and follow-up reviews.
Update the status column as items are resolved rather than deleting them — the record of
what was wrong and why is worth as much as the fix.

All findings were verified by querying the live database, not inferred from migration files.
Where the database and `supabase/migrations/` disagree, the database is treated as truth
(see [F14](#f14-migration-drift)).

---

## 1. The Estate

Ten tables in `public`, one auth-integrated identity table, five functions, one trigger,
zero views, zero materialized views.

| Table | Rows | Role |
|---|---|---|
| `profiles` | 8 | Members; PK is FK to `auth.users.id` (cascade delete) |
| `seasons` | 4 | Season header |
| `weeks` | 39 | Pool week; pick requirements, open/close windows |
| `games` | 1,110 | Schedule + result; sourced from ESPN/CFBD |
| `picks` | 0 | Member selections |
| `weekly_scores` | 0 | Per-member/week score cache |
| `pick_audit_log` | 0 | Admin override trail |
| `historical_picks` | 648 | 2024 season, imported |
| `teams` | **0** | Reference data — created, never populated, never referenced |
| `invites` | 0 | Onboarding tokens |

Volume is lopsided. Season 3 (2026) holds 1,078 games across 19 weeks. Season 1
("2025 Season", 16 games, 10 FINAL) and season 4 ("2026 NFL Preseason", 16 games) look like
test residue. Season 2 ("2024 Season") is a 14-week stub with **zero games**, despite 648
historical picks nominally belonging to it.

### Relationships

```
auth.users ─1:1─► profiles ─┬─1:N─► picks ──N:1─► games ──N:1─► weeks ──N:1─► seasons
                            │         └─────────────N:1────────────┘  (redundant week_id)
                            ├─1:N─► weekly_scores ──N:1─► weeks
                            ├─1:N─► pick_audit_log ◄─N:1─ picks
                            ├─1:N─► invites (invited_by)
                            └─0:N─► historical_picks   [ON DELETE SET NULL]

teams ────────── (orphaned: no FK in or out, 0 rows)
historical_picks ⇢ seasons / weeks  ONLY via loose ints (season_year, week_number)
```

### Invariants the database actually enforces

- `picks (member_id, game_id)` unique — one pick per game per member
- `picks (member_id, week_id) WHERE is_lotw` unique — one Lock of the Week
- `weekly_scores (member_id, week_id)` unique
- `games (sport, external_id)` unique — idempotent sync key (verified: 0 nulls)
- `weeks_pick_split_matches_total` — CFB + NFL picks sum to `required_picks`, or both NULL
- `weekly_scores.total` — generated column, `pick_points + forfeit_penalty + lotw_penalty`

### Data-quality baseline (2026-09-04)

Referential integrity is clean where it exists: 0 orphaned profiles, 0 users without
profiles, 0 orphaned historical picks, 0 FINAL games without a winner, 0 winners on
non-FINAL games, 0 duplicate matchups within a week, 0 kickoffs before their week opens,
0 games missing `external_id`.

---

## 2. Findings

Severity reflects blast radius × likelihood, not effort to fix.

| ID | Finding | Severity | Status |
|---|---|---|---|
| [F1](#f1-scoring-functions-are-world-writable-via-the-rest-api) | Scoring RPCs world-writable via REST | 🔴 Critical | Open |
| [F2](#f2-rls-is-decorative--the-whole-app-runs-as-service_role) | RLS decorative; app runs as `service_role` | 🔴 Critical | Open |
| [F3](#f3-live-scoring-model-diverges-from-league-history-cutting-off-reconciliation) | Scoring model diverges from history (by design) | 🟠 High | **Resolved 2026-09-08** |
| [F4](#f4-team-identity-is-unnormalized-free-text-the-teams-table-is-dead) | Team identity is free text; `teams` dead | 🟠 High | Open |
| [F5](#f5-historical_picks-is-a-disconnected-island-with-a-second-scoring-vocabulary) | `historical_picks` disconnected island | 🟠 High | Open |
| [F6](#f6-forfeit-penalties-ignore-the-cfbnfl-split) | Forfeits ignore CFB/NFL split | 🟠 High | Open |
| [F7](#f7-there-is-no-current-week--its-inferred-and-nothing-makes-it-unique) | No "current week"; inferred, not unique | 🟠 High | Partial |
| [F8](#f8-weekly_scores-is-an-uninvalidated-cache) | `weekly_scores` cache never invalidated | 🟡 Medium | Open |
| [F9](#f9-realtime-leaderboard-is-silently-dead) | Realtime leaderboard silently dead | 🟡 Medium | Open |
| [F10](#f10-eight-unindexed-foreign-keys) | Eight unindexed foreign keys | 🟡 Medium | Open |
| [F11](#f11-rls-policy-hygiene-62-advisor-warnings) | RLS policy hygiene (62 warnings) | 🟡 Medium | Open |
| [F12](#f12-two-competing-audit-mechanisms-for-pick-overrides) | Two competing override audit trails | 🟡 Medium | Open |
| [F13](#f13-picksupdated_at-is-never-maintained) | `picks.updated_at` never maintained | 🟡 Medium | Open |
| [F14](#f14-migration-drift) | Migration drift | 🟢 Low | **Resolved 2026-09-04** |
| [F15](#f15-test-residue-in-production) | Test-season residue in production | 🟢 Low | Partial |
| [F16](#f16-invites-lacks-a-unique-email-and-a-link-to-the-resulting-profile) | `invites` lacks unique email / profile link | 🟢 Low | Open |
| [F17](#f17-weekly_scores-penalty-columns-are-unconstrained) | Penalty columns unconstrained | 🟢 Low | Open |
| [F18](#f18-known-data-gaps-persist) | Known schedule/data gaps | 🟢 Low | Open |
| [F19](#f19-enum-by-check) | Enum-by-CHECK inconsistency | 🟢 Low | Open |

---

### 🔴 Critical

#### F1. Scoring functions are world-writable via the REST API

`resolve_game(uuid, text)` and `close_week(int)` are `SECURITY DEFINER`, contain **no
internal authorization check**, and carry `EXECUTE` for both `anon` and `authenticated`:

```
close_week    → anon:EXECUTE, authenticated:EXECUTE   SECURITY DEFINER
resolve_game  → anon:EXECUTE, authenticated:EXECUTE   SECURITY DEFINER
```

The anon key ships to the browser. Anyone holding it can `POST /rest/v1/rpc/resolve_game`
with any `game_id` and any winner; the function flips the result, recomputes every member's
`picks.points`, and rewrites `weekly_scores` — bypassing RLS by design. `close_week` likewise
applies forfeit penalties to the whole league on demand. These two functions *are* the
integrity model of the pool, and they are an unauthenticated HTTP endpoint.
`handle_new_user()` and `rls_auto_enable()` are exposed the same way.

The application only ever calls them through the service-role client, so the grants buy
nothing.

```sql
revoke execute on function public.resolve_game(uuid, text)  from anon, authenticated;
revoke execute on function public.close_week(integer)       from anon, authenticated;
revoke execute on function public.handle_new_user()         from anon, authenticated;
revoke execute on function public.rls_auto_enable()         from anon, authenticated;

alter function public.resolve_game(uuid, text) set search_path = '';
alter function public.close_week(integer)      set search_path = '';
```

Then add a defensive guard inside each: `if auth.role() <> 'service_role' then raise
exception 'forbidden'; end if;`

#### F2. RLS is decorative — the whole app runs as `service_role`

`src/lib/supabase/admin.ts` is imported by 27 files, including member-facing pages
(`(member)/picks`, `(member)/leaderboard`, `(member)/stats/[memberId]`,
`(member)/analytics`). Service role bypasses RLS unconditionally, so 22 carefully written
policies never execute in production and 100% of authorization lives in route-handler code.

Clearest symptom: `picks_own_read` + `picks_post_kickoff_read` exist to hide other members'
picks until kickoff — a load-bearing rule for a pick'em pool. It is not enforced. Whether
`/pick-grid` leaks pre-kickoff picks depends entirely on a hand-written filter in a React
Server Component, with no database backstop.

This is a defensible architecture *if chosen deliberately* (server-side authz, DB as dumb
store). It is not defensible alongside F1, because then neither layer holds. Pick one:
move member reads onto the anon/user client and let RLS work, or accept
service-role-everywhere and delete the policies so nobody is lulled by them.

---

### 🟠 High

#### F3. Live scoring model diverges from league history, cutting off reconciliation

> **Framing note (added on review of the spec):** this is a *deliberate design decision*, not
> an oversight. `openspec/changes/betting-tracker/proposal.md` specifies "select a team for
> each game" and "+1 win / 0 push / -1 loss"; the word "spread" appears in no spec file. The
> finding stands as a **consequence to confirm and plan around**, not a defect to fix.

The most consequential structural divergence, and it is live: pool week 1 (`weeks.id = 21`)
opened 2026-08-29.

Of 648 historical picks, 292 carry a *signed* point spread (`"Texans +3.5"`, `"GT -5.5"`),
26 are moneylines (`"Jets ML"`), one is a total (`"O 36.5 cheifs"`). This league bets
**against the spread**.

> **Correction, 2026-09-08.** Two of those counts were wrong, and the second was wrong by
> enough to change the conclusion. Re-parsing all 648 rows (totals must be matched *before*
> spreads, or `"Chiefs Raider U45.5"` falls through to the spread branch):
>
> | Shape | Real count | Stated above |
> |---|---:|---:|
> | Spreads — 292 signed **plus 138 unsigned** (`"Bears 1.5"`, `"Bama 7"`) | **430** | 292 |
> | Totals — 81 with a number, 8 without | **89** | 1 |
> | Moneylines | 26 | 26 |
> | LOTW placeholder — `bet_text` is the literal string `LOTW`, no bet detail | 84 | — |
> | Team-only, undecidable | 19 | — |
>
> Totals are the **third-largest shape in league history**, not a one-off. The original
> count of 1 understated them by ~89×, which materially understated the case for
> first-class over/under support.

The live model has no spread. `games` has `home_team, away_team, home_score, away_score,
winner` and nothing else — no `spread`, no `line`, no `total`. A case-insensitive grep for
`spread|line|odds` across `src/` returns zero hits. `picks.picked_team` is `HOME|AWAY`, and
`src/lib/sports/sync.ts:154` resolves via `deriveWinner(home_score, away_score)` —
straight up.

So the 2026 season scores straight-up winners while the league's entire history assumes ATS.
A 3-point favorite winning by 1 scores as a win under the new system and a loss under the
old. Two concrete consequences, neither of which the spec addresses:

1. **Year-over-year stats are not comparable.** The analytics capability
   (`openspec/.../specs/historical-analytics`) presents all-time standings, win %, and LOTW
   records spanning both eras as if one metric. It is two metrics in one column.
2. **`historical_picks` → `games` reconciliation is impossible**, not merely hard — there is
   no column to reconcile a spread into. This blocks the long-standing goal of converting
   `bet_text` into structured picks.

Either accept the break and label the eras distinctly in analytics (cheap, honest), or
introduce a spread and score ATS:

```sql
alter table games
  add column spread numeric(4,1),
  add column spread_source text;
```

plus a `PUSH` path in `resolve_game` when the margin equals the spread.

> **Resolved 2026-09-08 — option (b), and wider than proposed.** Hayes ruled that all three
> bet types the history contains are valid: `ML`, `SPREAD` and `TOTAL`. The line is **not**
> a column on `games` as sketched above — it lives on the pick and is **entered by the
> member**, because the league bets across different books at different times and two
> members may hold different numbers on the same game.
>
> Shipped in `supabase/migrations/20260908195803_wager_types.sql`: `picks` gains `bet_type`,
> `line` and `odds` (all `not null` bar the price, with **no defaults** — possible only
> because `picks` was still empty), `picked_team` is renamed to `selection` and widened to
> `HOME|AWAY|OVER|UNDER`, and a new `grade_pick()` grades every wager against its own line.
> `resolve_game` is now score-driven — `(game_id, home_score, away_score)` — because a
> spread cannot be graded from "HOME won".
>
> Specs: `openspec/changes/wager-types/`. The -120 price rule is captured but **not
> enforced**; `odds` is only range-checked as a plausible American price.
>
> Consequence 1 above is **narrower than stated**: `analytics/page.tsx` reads `picks` and
> `weekly_scores` only, and `historical_picks` is read by **no page at all** (it appears in
> `src/types/database.ts` and nowhere else). The two eras are not currently being summed in
> one column — the risk is latent, not live.
>
> Consequence 2 is **unblocked in principle but still gated**: there is now somewhere to put
> a spread or a total, but 84 LOTW rows carry no bet detail whatsoever, 19 are undecidable,
> 138 unsigned spreads have no recoverable side, `teams` is empty (F4), and the database
> holds **no 2024 games** to reconcile against. See W12.4.

#### F4. Team identity is unnormalized free text; the `teams` table is dead

`games.home_team` / `away_team` are `text` with no FK — 288 distinct name strings across
1,110 games. `teams` exists with `name UNIQUE`, `abbreviation`, `sport`, `external_id`
(exactly the right shape) and holds **zero rows** and **zero code references**.

Consequences: no team-level analytics ("how do I do picking Georgia?"); no way to fuzzy-match
`bet_text` → game (history contains `"Seahwaks"`, `"Benagls"`, `"Vtech"`, `"cheifs"` —
misspellings a lookup table with aliases would absorb); ESPN and CFBD naming differences
silently produce distinct strings for one team.

Populate `teams`, add a `team_aliases` child table, migrate `games` to
`home_team_id`/`away_team_id`. Do it while `picks` is empty — the cost only rises.

#### F5. `historical_picks` is a disconnected island with a second scoring vocabulary

It links to season by `season_year int` (not FK to `seasons.id`) and to week by
`week_number int` (not FK to `weeks.id`), so the "2024 Season" row (`seasons.id = 2`,
14 weeks, 0 games) and the 648 picks belonging to it are joined by convention only.
`result` is `'Win'|'Lose'|'Push'`; the live model uses `picked_team HOME|AWAY` +
`points int`. Two incompatible domains with no bridging view, so leaderboard and stats pages
special-case history everywhere.

Also: 6 distinct `display_name` values in history vs 8 profiles — either two current members
have no 2024 record, or two 2024 names were never mapped.

> **Name question answered 2026-09-04.** It was the former. The roster was rebuilt that day
> (9 synthetic seed profiles deleted, 8 real members created), and all 648 historical picks
> now carry a populated `member_id`, matched on `display_name`. Griffin and Andrew are the
> two members with no 2024 record — they are new to the pool, not unmapped names.
>
> The structural finding stands: `season_year` / `week_number` are still loose ints with no
> FK, and the two scoring vocabularies still have no bridging view.

#### F6. Forfeit penalties ignore the CFB/NFL split

`close_week` computes `v_forfeit := greatest(0, v_required_picks - v_pick_count) * -1` using
only the untyped total. Migration `20260725145656_week_sport_pick_split` added
`required_cfb_picks` / `required_nfl_picks` and a sum check, but the scoring function was
never updated. In a 5 CFB + 4 NFL week, a member submitting 9 CFB picks is penalty-free.
16 of 19 weeks in season 3 carry a split, so this is the normal case, not an edge case.

#### F7. There is no "current week" — it's inferred, and nothing makes it unique

`weeks.status` is `OPEN|CLOSED`, and the app derives "now" via
`weeks.find(w => w.status === 'OPEN')` (`(member)/leaderboard/page.tsx:14`,
`(admin)/pick-grid/page.tsx:20`, `(admin)/results/page.tsx:31`). Nothing constrains that to
one row — and `/api/admin/weeks/[id]/reopen` sets a second week `OPEN` by design. With two
open weeks the app silently picks whichever sorts first, across *all* seasons.

Worse, the two-value domain conflates three states. Weeks 2–18 of season 3 are marked
`CLOSED` meaning *"hasn't happened yet"*, while week 0 is `CLOSED` meaning *"finished and
scored"*. `close_week()` applies forfeit penalties — run it against a future week and the
entire league is penalised for not picking games that have not kicked off.

```sql
alter table weeks drop constraint weeks_status_check;
alter table weeks add constraint weeks_status_check
  check (status in ('UPCOMING','OPEN','SCORED'));

create unique index weeks_one_open_per_season on weeks (season_id) where status = 'OPEN';
```

Add `seasons.is_current boolean` with a partial unique index rather than inferring the
season from an open week.

> **Partially resolved 2026-09-04** (`82f7557`). The season half landed — as
> `seasons.is_active` rather than `is_current`, with partial unique index
> `seasons_one_active_idx` allowing at most one active season. `getActiveSeasonId()`
> (`src/lib/seasons.ts`) is now the shared accessor and all five call sites scope through it,
> so current-week resolution is deterministic and cannot cross season boundaries. This was
> not theoretical: the 2026 NFL Preseason week was the only OPEN week in the database and was
> being served on `/picks` in place of the live season.
>
> The `weeks.status` half is untouched. It is still a two-value domain conflating three
> states, there is still no one-open-week constraint, and `close_week` will still penalise a
> league for a week that has not kicked off.

---

### 🟡 Medium

#### F8. `weekly_scores` is an uninvalidated cache

Maintained solely by `resolve_game` and `close_week`; no triggers on `picks`. Insert, update,
or delete a pick after its game resolved — or un-resolve a game — and the cached score drifts
silently with nothing to detect it. `/api/admin/picks/override` does call `resolve_game`
afterward (`route.ts:80`), but that is a convention one future route can forget. Either add a
trigger on `picks`, or make the leaderboard a view over `picks` and keep `weekly_scores` for
penalties only.

#### F9. Realtime leaderboard is silently dead

`LeaderboardClient.tsx:79-82` subscribes to `postgres_changes` on `public.weekly_scores`. The
`supabase_realtime` publication contains **zero public tables**. The channel connects and no
event ever arrives.

```sql
alter publication supabase_realtime add table public.weekly_scores;
```

Note: a table written via service role will not broadcast to an anon-key client subject to
RLS, so F2 needs resolving first for this to be useful.

#### F10. Eight unindexed foreign keys

`games.week_id`, `picks.game_id`, `picks.week_id`, `picks.overridden_by`,
`weekly_scores.week_id`, `pick_audit_log.pick_id`, `pick_audit_log.changed_by`,
`invites.invited_by`.

`games.week_id` matters *now* — 1,110 rows and every page filters by week. The `picks` ones
bite the moment members start submitting.

#### F11. RLS policy hygiene (62 advisor warnings)

- 18 × `auth_rls_initplan` — `auth.uid()` / `auth.role()` re-evaluated per row instead of
  `(select auth.uid())`
- 44 × `multiple_permissive_policies` — the `FOR ALL` admin policies stack onto every
  SELECT, so each read evaluates both

Compounding this, most policies target role `public` rather than `authenticated`, so they are
also evaluated for `anon`. Cosmetic while F2 stands; real the moment reads route through RLS.

#### F12. Two competing audit mechanisms for pick overrides

`picks.overridden_by` / `overridden_at` (last-write-only) *and* `pick_audit_log` (full
history). Only the latter is written (`api/admin/picks/override/route.ts:56`). Drop the
columns or populate them.

#### F13. `picks.updated_at` is never maintained

No trigger, no application write. It will permanently equal `created_at` and quietly lie in
any audit query.

---

### 🟢 Low / Hygiene

#### F14. Migration drift

The database has `20260725173415_seasons_allow_multiple_per_year` applied;
`supabase/migrations/` contains only 5 files and does **not** include it. A rebuild from
migrations produces a different schema than production. Fix before the next migration —
drift compounds.

> **Resolved 2026-09-04** (`bd3e712`). The missing file did not need reconstructing: Supabase
> retains the executed SQL in `supabase_migrations.schema_migrations.statements`, so it was
> recovered verbatim, original comments included. Use that source if drift recurs.
>
> A second, self-inflicted drift surfaced during the fix — `apply_migration` assigns its own
> timestamp, so a locally-authored filename will not match the recorded version unless it is
> renamed afterward. Local files and `list_migrations` now agree on all seven versions.
> W1.4 (a drift check in the workflow) remains open, so nothing prevents a recurrence.

#### F15. Test residue in production

Season 1 ("2025 Season", 5 weeks, 16 games, 10 already FINAL) and season 4
("2026 NFL Preseason") are indistinguishable from real seasons to every query in the app —
`analytics/page.tsx:33` lists all seasons unfiltered.

> **Partially mitigated 2026-09-04.** `seasons.is_active` now distinguishes the live season,
> and the week-resolution paths respect it, so a stale season can no longer supply the current
> week. The 86 picks and 40 `weekly_scores` rows belonging to season 1's seed members were
> deleted with those profiles.
>
> The seasons themselves still exist and `analytics/page.tsx:33` still lists all of them
> unfiltered, so they remain visible in member-facing analytics. Whether to delete or filter
> is still open — see the W13.1 decision.

#### F16. `invites` lacks a unique email and a link to the resulting profile

No unique constraint on `email` (case-variant duplicates possible; `citext` or a functional
unique index would fix it), and no record of which invite onboarded whom.

#### F17. `weekly_scores` penalty columns are unconstrained

`forfeit_penalty` / `lotw_penalty` are semantically ≤ 0 (the generated `total` *adds* them),
but nothing enforces it. A positive value silently inflates a score.

```sql
alter table weekly_scores
  add constraint weekly_scores_forfeit_nonpositive check (forfeit_penalty <= 0),
  add constraint weekly_scores_lotw_nonpositive    check (lotw_penalty <= 0);
```

#### F18. Known data gaps persist

Zero CFB games in pool weeks 13–18; weeks 19–21 (postseason) absent; weeks 0 and 15 have NULL
pick splits.

#### F19. Enum-by-CHECK

Ten CHECK constraints across seven vocabularies (`sport`, `status` ×2, `winner`, `role`,
`close_mode`, `resolution_mode`, `result`). Acceptable at this scale, but
`historical_picks.result` uses Title Case while every other vocabulary is UPPER — an
inconsistency that will trip a join eventually.

---

## 3. Recommended Order

**Before week 1 closes (2026-09-08)**

1. **F1** — revoke the RPC grants. One migration, five minutes, closes a hole that lets
   anyone rewrite the season.
2. **F3** — confirm straight-up vs. ATS. The spec already chose straight-up; this is about
   confirming the league agrees and planning for the history break. It is the only finding
   where waiting makes the alternative *harder*.
3. **F6** — split-aware forfeits, before `close_week` runs on a split week for real.

**This month, while `picks` is still empty**

4. **F4** — populate `teams`, migrate `games` to team FKs. Zero-downtime now; a data
   migration later.
5. **F7** — three-state week status + uniqueness.
6. **F2** — decide the authz model explicitly, then make the schema match the decision.
7. **F10** — the eight FK indexes (a single migration).

**Then**

8. F5, F8, F9 and the remaining medium tier. ~~**F14** first among them, since drift makes
   every subsequent migration riskier.~~ — F14 resolved 2026-09-04.

> **Status note, 2026-09-04.** Items 1 (F1) and 6 (F2) were reviewed by Hayes and
> **accepted as known risk for now** on a private ~8-person league. They stay documented and
> unresolved by choice; do not re-open them as urgent each session. Revisit if the app moves
> to a public deployment, which changes the exposure of the anon key materially.

---

## 4. Assessment

The constraint design is genuinely good — the partial unique index for LOTW, the
`(sport, external_id)` sync key, the split-sum check, and the generated `total` are the work
of someone thinking about invariants, and the clean data baseline in §1 is the result.

The problems concentrate in two places: **what is exposed** (F1, F2) and **what the model
cannot say** (F3, F4). Both are addressable now at a fraction of what they will cost once
8 members × 9 picks × 18 weeks of real data sits on top of them.

Remediation work items derived from these findings live in
[`database-remediation-backlog.md`](./database-remediation-backlog.md).

---

## Review Log

| Date | Reviewer | Scope | Notes |
|---|---|---|---|
| 2026-09-04 | Claude (data architect review) | Full `public` schema, RLS, functions, advisors, data quality | Initial review. 19 findings, 2 critical. |
| 2026-09-04 | Claude (go-live session) | F5, F7, F14, F15 | Status pass after week 1 go-live. F14 resolved; F7 and F15 partial; F5's roster question answered. F1 and F2 accepted as known and deferred by Hayes — not to be re-raised as blocking. |
| 2026-09-08 | Claude (wager-types session) | F3, F4, F10 | **F3 resolved** — all three bet types shipped with member-entered lines (`openspec/changes/wager-types/`, migration `20260908195803`). **F3's bet-shape counts were wrong and are corrected here: 89 totals, not 1; 430 spreads, not 292.** Two of F10's eight indexes landed with it. F4 is now the binding constraint on `bet_text` reconciliation, not F3. |
| 2026-09-08 | Claude (week 2 open) | F6, F7 | Week 1 closed (direct `UPDATE`, not `close_week` — zero picks by design, no forfeits booked); week 2 opened. Exactly one OPEN week again. **F6 tabled by Hayes**; exposure begins when the first split week is *closed*, not opened. F7's missing one-open-week constraint bit in rehearsal: three pages resolve the open week with `.find()` over an ascending list and would have landed on week 1 while `/picks` served week 2. |

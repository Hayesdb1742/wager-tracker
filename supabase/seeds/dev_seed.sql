-- ============================================================
-- DEV SEED — prototype data for leaderboard / UI development
-- Run once in the Supabase SQL editor. Safe to re-run thanks to
-- ON CONFLICT DO NOTHING guards.
-- ============================================================

BEGIN;

-- ── PROFILES (bypass FK → auth.users so we don't need real auth rows) ──────────
-- UUIDs used throughout this file:
--   Bryce:  aa000001-0000-0000-0000-000000000001
--   Emma:   bb000002-0000-0000-0000-000000000002
--   Jack:   cc000003-0000-0000-0000-000000000003
--   Sophie: dd000004-0000-0000-0000-000000000004
--   Marcus: ee000005-0000-0000-0000-000000000005
--   Lily:   ff000006-0000-0000-0000-000000000006
--   Derek:  aa000007-0000-0000-0000-000000000007
--   Alyssa: bb000008-0000-0000-0000-000000000008
--   Tyler:  cc000009-0000-0000-0000-000000000009

SET session_replication_role = replica;

INSERT INTO public.profiles (id, display_name, role, is_active, created_at) VALUES
  ('aa000001-0000-0000-0000-000000000001', 'Bryce',  'MEMBER', true, NOW() - INTERVAL '60 days'),
  ('bb000002-0000-0000-0000-000000000002', 'Emma',   'MEMBER', true, NOW() - INTERVAL '60 days'),
  ('cc000003-0000-0000-0000-000000000003', 'Jack',   'MEMBER', true, NOW() - INTERVAL '60 days'),
  ('dd000004-0000-0000-0000-000000000004', 'Sophie', 'MEMBER', true, NOW() - INTERVAL '60 days'),
  ('ee000005-0000-0000-0000-000000000005', 'Marcus', 'MEMBER', true, NOW() - INTERVAL '60 days'),
  ('ff000006-0000-0000-0000-000000000006', 'Lily',   'MEMBER', true, NOW() - INTERVAL '60 days'),
  ('aa000007-0000-0000-0000-000000000007', 'Derek',  'MEMBER', true, NOW() - INTERVAL '60 days'),
  ('bb000008-0000-0000-0000-000000000008', 'Alyssa', 'MEMBER', true, NOW() - INTERVAL '60 days'),
  ('cc000009-0000-0000-0000-000000000009', 'Tyler',  'MEMBER', true, NOW() - INTERVAL '60 days')
ON CONFLICT (id) DO NOTHING;

SET session_replication_role = DEFAULT;

-- ── SEASON ───────────────────────────────────────────────────────────────────
INSERT INTO public.seasons (id, name, year, created_at) VALUES
  (1, '2025 Season', 2025, NOW() - INTERVAL '60 days')
ON CONFLICT (id) DO NOTHING;
SELECT setval('public.seasons_id_seq', 1, true);

-- ── WEEKS (4 closed + 1 open) ─────────────────────────────────────────────────
INSERT INTO public.weeks (id, season_id, week_number, required_picks, opens_at, closes_at, status) VALUES
  (1, 1, 1, 5, NOW()-INTERVAL '56 days', NOW()-INTERVAL '50 days', 'CLOSED'),
  (2, 1, 2, 5, NOW()-INTERVAL '49 days', NOW()-INTERVAL '43 days', 'CLOSED'),
  (3, 1, 3, 5, NOW()-INTERVAL '42 days', NOW()-INTERVAL '36 days', 'CLOSED'),
  (4, 1, 4, 5, NOW()-INTERVAL '35 days', NOW()-INTERVAL '29 days', 'CLOSED'),
  (5, 1, 5, 5, NOW()-INTERVAL '7 days',  NOW()+INTERVAL '2 days',  'OPEN')
ON CONFLICT (id) DO NOTHING;
SELECT setval('public.weeks_id_seq', 5, true);

-- ── WEEK 4 GAMES (all FINAL) ──────────────────────────────────────────────────
-- Winners: G1=HOME G2=HOME G3=AWAY G4=HOME G5=AWAY G6=HOME G7=HOME G8=HOME
INSERT INTO public.games (id, week_id, sport, home_team, away_team, kickoff_time, status, winner, in_pool, external_id) VALUES
  ('40000001-0000-0000-0000-000000000001', 4, 'CFB', 'Alabama',    'Auburn',        NOW()-INTERVAL '32 days', 'FINAL', 'HOME', true, 'seed-4-1'),
  ('40000002-0000-0000-0000-000000000002', 4, 'CFB', 'Georgia',    'Tennessee',     NOW()-INTERVAL '32 days', 'FINAL', 'HOME', true, 'seed-4-2'),
  ('40000003-0000-0000-0000-000000000003', 4, 'CFB', 'Ohio State', 'Penn State',    NOW()-INTERVAL '32 days', 'FINAL', 'AWAY', true, 'seed-4-3'),
  ('40000004-0000-0000-0000-000000000004', 4, 'CFB', 'Michigan',   'Michigan St',   NOW()-INTERVAL '32 days', 'FINAL', 'HOME', true, 'seed-4-4'),
  ('40000005-0000-0000-0000-000000000005', 4, 'NFL', 'Cowboys',    'Eagles',        NOW()-INTERVAL '31 days', 'FINAL', 'AWAY', true, 'seed-4-5'),
  ('40000006-0000-0000-0000-000000000006', 4, 'NFL', 'Chiefs',     'Raiders',       NOW()-INTERVAL '31 days', 'FINAL', 'HOME', true, 'seed-4-6'),
  ('40000007-0000-0000-0000-000000000007', 4, 'NFL', 'Packers',    'Bears',         NOW()-INTERVAL '31 days', 'FINAL', 'HOME', true, 'seed-4-7'),
  ('40000008-0000-0000-0000-000000000008', 4, 'NFL', 'Bills',      'Dolphins',      NOW()-INTERVAL '31 days', 'FINAL', 'HOME', true, 'seed-4-8')
ON CONFLICT (sport, external_id) DO NOTHING;

-- ── WEEK 5 GAMES (mix of locked FINAL + upcoming SCHEDULED) ──────────────────
INSERT INTO public.games (id, week_id, sport, home_team, away_team, kickoff_time, status, winner, in_pool, external_id) VALUES
  ('50000001-0000-0000-0000-000000000001', 5, 'CFB', 'LSU',        'Ole Miss',      NOW()-INTERVAL '3 days',  'FINAL',     'HOME', true, 'seed-5-1'),
  ('50000002-0000-0000-0000-000000000002', 5, 'NFL', 'Patriots',   'Jets',          NOW()-INTERVAL '2 days',  'FINAL',     'AWAY', true, 'seed-5-2'),
  ('50000003-0000-0000-0000-000000000003', 5, 'CFB', 'Oklahoma',   'Texas',         NOW()+INTERVAL '1 day',   'SCHEDULED', NULL,   true, 'seed-5-3'),
  ('50000004-0000-0000-0000-000000000004', 5, 'CFB', 'Florida',    'Florida St',    NOW()+INTERVAL '1 day',   'SCHEDULED', NULL,   true, 'seed-5-4'),
  ('50000005-0000-0000-0000-000000000005', 5, 'NFL', 'Ravens',     'Bengals',       NOW()+INTERVAL '2 days',  'SCHEDULED', NULL,   true, 'seed-5-5'),
  ('50000006-0000-0000-0000-000000000006', 5, 'NFL', 'Rams',       '49ers',         NOW()+INTERVAL '2 days',  'SCHEDULED', NULL,   true, 'seed-5-6'),
  ('50000007-0000-0000-0000-000000000007', 5, 'CFB', 'USC',        'Oregon',        NOW()+INTERVAL '3 days',  'SCHEDULED', NULL,   true, 'seed-5-7'),
  ('50000008-0000-0000-0000-000000000008', 5, 'NFL', 'Steelers',   'Browns',        NOW()+INTERVAL '3 days',  'SCHEDULED', NULL,   true, 'seed-5-8')
ON CONFLICT (sport, external_id) DO NOTHING;

-- ── WEEK 4 PICKS (points auto-computed from game.winner) ─────────────────────
-- Pick matrix:
--          G1    G2    G3    G4    G5    G6    G7    G8    LOTW
-- Bryce:   HOME  HOME  AWAY  HOME  AWAY  HOME* HOME  HOME  G6 → W8 total=9
-- Emma:    HOME  HOME  AWAY  HOME  AWAY  HOME  HOME* HOME  G7 → W8 total=9
-- Marcus:  HOME  HOME  AWAY  HOME  HOME  HOME* HOME  HOME  G6 → W7 L1 total=7
-- Sophie:  HOME  AWAY  AWAY  HOME  AWAY  HOME  HOME  HOME* G8 → W7 L1 total=7
-- Hayes:   HOME  HOME  HOME* HOME  AWAY  HOME  HOME  HOME  G3 LOTW LOSS → total=5
-- Jack:    AWAY  HOME  AWAY  HOME  HOME  HOME  HOME  HOME* G8 → W6 L2 total=5
-- Lily:    HOME  HOME  HOME  AWAY  AWAY  AWAY  HOME  HOME* G8 → W5 L3 total=3
-- Derek:   HOME  AWAY  AWAY  AWAY  HOME  HOME  AWAY  HOME* G8 → W4 L4 total=1
-- Alyssa:  AWAY  HOME  HOME  AWAY  HOME  AWAY  HOME  HOME* G8 → W3 L5 total=-1
-- Tyler:   AWAY  AWAY  HOME  AWAY  HOME  AWAY  AWAY  AWAY* G8 → W0 L8 LOTW LOSS total=-9

INSERT INTO public.picks (member_id, game_id, week_id, bet_type, selection, line, is_lotw, points)
WITH raw_picks (member_id, game_id, selection, is_lotw) AS (VALUES
  -- Bryce
  ('aa000001-0000-0000-0000-000000000001'::uuid,'40000001-0000-0000-0000-000000000001'::uuid,'HOME'::text,false),
  ('aa000001-0000-0000-0000-000000000001'::uuid,'40000002-0000-0000-0000-000000000002'::uuid,'HOME',false),
  ('aa000001-0000-0000-0000-000000000001'::uuid,'40000003-0000-0000-0000-000000000003'::uuid,'AWAY',false),
  ('aa000001-0000-0000-0000-000000000001'::uuid,'40000004-0000-0000-0000-000000000004'::uuid,'HOME',false),
  ('aa000001-0000-0000-0000-000000000001'::uuid,'40000005-0000-0000-0000-000000000005'::uuid,'AWAY',false),
  ('aa000001-0000-0000-0000-000000000001'::uuid,'40000006-0000-0000-0000-000000000006'::uuid,'HOME',true),
  ('aa000001-0000-0000-0000-000000000001'::uuid,'40000007-0000-0000-0000-000000000007'::uuid,'HOME',false),
  ('aa000001-0000-0000-0000-000000000001'::uuid,'40000008-0000-0000-0000-000000000008'::uuid,'HOME',false),
  -- Emma
  ('bb000002-0000-0000-0000-000000000002'::uuid,'40000001-0000-0000-0000-000000000001'::uuid,'HOME',false),
  ('bb000002-0000-0000-0000-000000000002'::uuid,'40000002-0000-0000-0000-000000000002'::uuid,'HOME',false),
  ('bb000002-0000-0000-0000-000000000002'::uuid,'40000003-0000-0000-0000-000000000003'::uuid,'AWAY',false),
  ('bb000002-0000-0000-0000-000000000002'::uuid,'40000004-0000-0000-0000-000000000004'::uuid,'HOME',false),
  ('bb000002-0000-0000-0000-000000000002'::uuid,'40000005-0000-0000-0000-000000000005'::uuid,'AWAY',false),
  ('bb000002-0000-0000-0000-000000000002'::uuid,'40000006-0000-0000-0000-000000000006'::uuid,'HOME',false),
  ('bb000002-0000-0000-0000-000000000002'::uuid,'40000007-0000-0000-0000-000000000007'::uuid,'HOME',true),
  ('bb000002-0000-0000-0000-000000000002'::uuid,'40000008-0000-0000-0000-000000000008'::uuid,'HOME',false),
  -- Jack
  ('cc000003-0000-0000-0000-000000000003'::uuid,'40000001-0000-0000-0000-000000000001'::uuid,'AWAY',false),
  ('cc000003-0000-0000-0000-000000000003'::uuid,'40000002-0000-0000-0000-000000000002'::uuid,'HOME',false),
  ('cc000003-0000-0000-0000-000000000003'::uuid,'40000003-0000-0000-0000-000000000003'::uuid,'AWAY',false),
  ('cc000003-0000-0000-0000-000000000003'::uuid,'40000004-0000-0000-0000-000000000004'::uuid,'HOME',false),
  ('cc000003-0000-0000-0000-000000000003'::uuid,'40000005-0000-0000-0000-000000000005'::uuid,'HOME',false),
  ('cc000003-0000-0000-0000-000000000003'::uuid,'40000006-0000-0000-0000-000000000006'::uuid,'HOME',false),
  ('cc000003-0000-0000-0000-000000000003'::uuid,'40000007-0000-0000-0000-000000000007'::uuid,'HOME',false),
  ('cc000003-0000-0000-0000-000000000003'::uuid,'40000008-0000-0000-0000-000000000008'::uuid,'HOME',true),
  -- Sophie
  ('dd000004-0000-0000-0000-000000000004'::uuid,'40000001-0000-0000-0000-000000000001'::uuid,'HOME',false),
  ('dd000004-0000-0000-0000-000000000004'::uuid,'40000002-0000-0000-0000-000000000002'::uuid,'AWAY',false),
  ('dd000004-0000-0000-0000-000000000004'::uuid,'40000003-0000-0000-0000-000000000003'::uuid,'AWAY',false),
  ('dd000004-0000-0000-0000-000000000004'::uuid,'40000004-0000-0000-0000-000000000004'::uuid,'HOME',false),
  ('dd000004-0000-0000-0000-000000000004'::uuid,'40000005-0000-0000-0000-000000000005'::uuid,'AWAY',false),
  ('dd000004-0000-0000-0000-000000000004'::uuid,'40000006-0000-0000-0000-000000000006'::uuid,'HOME',false),
  ('dd000004-0000-0000-0000-000000000004'::uuid,'40000007-0000-0000-0000-000000000007'::uuid,'HOME',false),
  ('dd000004-0000-0000-0000-000000000004'::uuid,'40000008-0000-0000-0000-000000000008'::uuid,'HOME',true),
  -- Marcus
  ('ee000005-0000-0000-0000-000000000005'::uuid,'40000001-0000-0000-0000-000000000001'::uuid,'HOME',false),
  ('ee000005-0000-0000-0000-000000000005'::uuid,'40000002-0000-0000-0000-000000000002'::uuid,'HOME',false),
  ('ee000005-0000-0000-0000-000000000005'::uuid,'40000003-0000-0000-0000-000000000003'::uuid,'AWAY',false),
  ('ee000005-0000-0000-0000-000000000005'::uuid,'40000004-0000-0000-0000-000000000004'::uuid,'HOME',false),
  ('ee000005-0000-0000-0000-000000000005'::uuid,'40000005-0000-0000-0000-000000000005'::uuid,'HOME',false),
  ('ee000005-0000-0000-0000-000000000005'::uuid,'40000006-0000-0000-0000-000000000006'::uuid,'HOME',true),
  ('ee000005-0000-0000-0000-000000000005'::uuid,'40000007-0000-0000-0000-000000000007'::uuid,'HOME',false),
  ('ee000005-0000-0000-0000-000000000005'::uuid,'40000008-0000-0000-0000-000000000008'::uuid,'HOME',false),
  -- Lily
  ('ff000006-0000-0000-0000-000000000006'::uuid,'40000001-0000-0000-0000-000000000001'::uuid,'HOME',false),
  ('ff000006-0000-0000-0000-000000000006'::uuid,'40000002-0000-0000-0000-000000000002'::uuid,'HOME',false),
  ('ff000006-0000-0000-0000-000000000006'::uuid,'40000003-0000-0000-0000-000000000003'::uuid,'HOME',false),
  ('ff000006-0000-0000-0000-000000000006'::uuid,'40000004-0000-0000-0000-000000000004'::uuid,'AWAY',false),
  ('ff000006-0000-0000-0000-000000000006'::uuid,'40000005-0000-0000-0000-000000000005'::uuid,'AWAY',false),
  ('ff000006-0000-0000-0000-000000000006'::uuid,'40000006-0000-0000-0000-000000000006'::uuid,'AWAY',false),
  ('ff000006-0000-0000-0000-000000000006'::uuid,'40000007-0000-0000-0000-000000000007'::uuid,'HOME',false),
  ('ff000006-0000-0000-0000-000000000006'::uuid,'40000008-0000-0000-0000-000000000008'::uuid,'HOME',true),
  -- Derek
  ('aa000007-0000-0000-0000-000000000007'::uuid,'40000001-0000-0000-0000-000000000001'::uuid,'HOME',false),
  ('aa000007-0000-0000-0000-000000000007'::uuid,'40000002-0000-0000-0000-000000000002'::uuid,'AWAY',false),
  ('aa000007-0000-0000-0000-000000000007'::uuid,'40000003-0000-0000-0000-000000000003'::uuid,'AWAY',false),
  ('aa000007-0000-0000-0000-000000000007'::uuid,'40000004-0000-0000-0000-000000000004'::uuid,'AWAY',false),
  ('aa000007-0000-0000-0000-000000000007'::uuid,'40000005-0000-0000-0000-000000000005'::uuid,'HOME',false),
  ('aa000007-0000-0000-0000-000000000007'::uuid,'40000006-0000-0000-0000-000000000006'::uuid,'HOME',false),
  ('aa000007-0000-0000-0000-000000000007'::uuid,'40000007-0000-0000-0000-000000000007'::uuid,'AWAY',false),
  ('aa000007-0000-0000-0000-000000000007'::uuid,'40000008-0000-0000-0000-000000000008'::uuid,'HOME',true),
  -- Alyssa
  ('bb000008-0000-0000-0000-000000000008'::uuid,'40000001-0000-0000-0000-000000000001'::uuid,'AWAY',false),
  ('bb000008-0000-0000-0000-000000000008'::uuid,'40000002-0000-0000-0000-000000000002'::uuid,'HOME',false),
  ('bb000008-0000-0000-0000-000000000008'::uuid,'40000003-0000-0000-0000-000000000003'::uuid,'HOME',false),
  ('bb000008-0000-0000-0000-000000000008'::uuid,'40000004-0000-0000-0000-000000000004'::uuid,'AWAY',false),
  ('bb000008-0000-0000-0000-000000000008'::uuid,'40000005-0000-0000-0000-000000000005'::uuid,'HOME',false),
  ('bb000008-0000-0000-0000-000000000008'::uuid,'40000006-0000-0000-0000-000000000006'::uuid,'AWAY',false),
  ('bb000008-0000-0000-0000-000000000008'::uuid,'40000007-0000-0000-0000-000000000007'::uuid,'HOME',false),
  ('bb000008-0000-0000-0000-000000000008'::uuid,'40000008-0000-0000-0000-000000000008'::uuid,'HOME',true),
  -- Tyler
  ('cc000009-0000-0000-0000-000000000009'::uuid,'40000001-0000-0000-0000-000000000001'::uuid,'AWAY',false),
  ('cc000009-0000-0000-0000-000000000009'::uuid,'40000002-0000-0000-0000-000000000002'::uuid,'AWAY',false),
  ('cc000009-0000-0000-0000-000000000009'::uuid,'40000003-0000-0000-0000-000000000003'::uuid,'HOME',false),
  ('cc000009-0000-0000-0000-000000000009'::uuid,'40000004-0000-0000-0000-000000000004'::uuid,'AWAY',false),
  ('cc000009-0000-0000-0000-000000000009'::uuid,'40000005-0000-0000-0000-000000000005'::uuid,'HOME',false),
  ('cc000009-0000-0000-0000-000000000009'::uuid,'40000006-0000-0000-0000-000000000006'::uuid,'AWAY',false),
  ('cc000009-0000-0000-0000-000000000009'::uuid,'40000007-0000-0000-0000-000000000007'::uuid,'AWAY',false),
  ('cc000009-0000-0000-0000-000000000009'::uuid,'40000008-0000-0000-0000-000000000008'::uuid,'AWAY',true)
)
SELECT
  r.member_id,
  r.game_id,
  4 AS week_id,
  'ML' AS bet_type,
  r.selection,
  0 AS line,
  r.is_lotw,
  CASE public.grade_pick('ML', r.selection, 0, g.home_score, g.away_score)
    WHEN 'WIN'  THEN CASE WHEN r.is_lotw THEN  2 ELSE  1 END
    WHEN 'LOSS' THEN CASE WHEN r.is_lotw THEN -2 ELSE -1 END
    WHEN 'PUSH' THEN 0
    ELSE NULL
  END AS points
FROM raw_picks r
JOIN public.games g ON g.id = r.game_id
WHERE NOT EXISTS (
  SELECT 1 FROM public.picks p
  WHERE p.member_id = r.member_id AND p.game_id = r.game_id
);

-- ── WEEK 5 PICKS (locked games have computed points; upcoming = NULL) ─────────
-- Locked: G1 LSU HOME wins, G2 Patriots HOME / Jets AWAY wins
INSERT INTO public.picks (member_id, game_id, week_id, bet_type, selection, line, is_lotw, points)
WITH raw_picks (member_id, game_id, selection, is_lotw) AS (VALUES
  -- Bryce: G1 HOME(W), G2 HOME(L), open picks G3/G4/G5
  ('aa000001-0000-0000-0000-000000000001'::uuid,'50000001-0000-0000-0000-000000000001'::uuid,'HOME'::text,false),
  ('aa000001-0000-0000-0000-000000000001'::uuid,'50000002-0000-0000-0000-000000000002'::uuid,'HOME',false),
  ('aa000001-0000-0000-0000-000000000001'::uuid,'50000003-0000-0000-0000-000000000003'::uuid,'HOME',false),
  ('aa000001-0000-0000-0000-000000000001'::uuid,'50000004-0000-0000-0000-000000000004'::uuid,'HOME',false),
  ('aa000001-0000-0000-0000-000000000001'::uuid,'50000005-0000-0000-0000-000000000005'::uuid,'HOME',false),
  -- Emma: G1 HOME(W), G2 AWAY LOTW(W), open picks G3/G4
  ('bb000002-0000-0000-0000-000000000002'::uuid,'50000001-0000-0000-0000-000000000001'::uuid,'HOME',false),
  ('bb000002-0000-0000-0000-000000000002'::uuid,'50000002-0000-0000-0000-000000000002'::uuid,'AWAY',true),
  ('bb000002-0000-0000-0000-000000000002'::uuid,'50000003-0000-0000-0000-000000000003'::uuid,'AWAY',false),
  ('bb000002-0000-0000-0000-000000000002'::uuid,'50000004-0000-0000-0000-000000000004'::uuid,'HOME',false),
  -- Marcus: G1 HOME(W), G2 HOME(L)
  ('ee000005-0000-0000-0000-000000000005'::uuid,'50000001-0000-0000-0000-000000000001'::uuid,'HOME',false),
  ('ee000005-0000-0000-0000-000000000005'::uuid,'50000002-0000-0000-0000-000000000002'::uuid,'HOME',false),
  ('ee000005-0000-0000-0000-000000000005'::uuid,'50000005-0000-0000-0000-000000000005'::uuid,'HOME',false),
  -- Sophie: G2 AWAY(W), open pick G3
  ('dd000004-0000-0000-0000-000000000004'::uuid,'50000002-0000-0000-0000-000000000002'::uuid,'AWAY',false),
  ('dd000004-0000-0000-0000-000000000004'::uuid,'50000003-0000-0000-0000-000000000003'::uuid,'HOME',false)
)
SELECT
  r.member_id,
  r.game_id,
  5 AS week_id,
  'ML' AS bet_type,
  r.selection,
  0 AS line,
  r.is_lotw,
  CASE
    WHEN g.status != 'FINAL' THEN NULL
    ELSE CASE public.grade_pick('ML', r.selection, 0, g.home_score, g.away_score)
      WHEN 'WIN'  THEN CASE WHEN r.is_lotw THEN  2 ELSE  1 END
      WHEN 'LOSS' THEN CASE WHEN r.is_lotw THEN -2 ELSE -1 END
      WHEN 'PUSH' THEN 0
      ELSE NULL
    END
  END AS points
FROM raw_picks r
JOIN public.games g ON g.id = r.game_id
WHERE NOT EXISTS (
  SELECT 1 FROM public.picks p
  WHERE p.member_id = r.member_id AND p.game_id = r.game_id
);

-- ── WEEKLY SCORES ─────────────────────────────────────────────────────────────
-- Weeks 1-3: direct insert (no individual picks for those weeks)
-- Season standings design:
--   Emma: 30 | Marcus: 28 | Bryce: 27 | Sophie: 25 | Jack: 20
--   Lily: 17 | Derek: 12  | Alyssa: 7 | Tyler: -4

INSERT INTO public.weekly_scores (member_id, week_id, pick_points, forfeit_penalty, lotw_penalty) VALUES
  -- Week 1
  ('aa000001-0000-0000-0000-000000000001', 1,  7, 0, 0), -- Bryce
  ('bb000002-0000-0000-0000-000000000002', 1,  6, 0, 0), -- Emma
  ('cc000003-0000-0000-0000-000000000003', 1,  5, 0, 0), -- Jack
  ('dd000004-0000-0000-0000-000000000004', 1,  6, 0, 0), -- Sophie
  ('ee000005-0000-0000-0000-000000000005', 1,  9, 0, 0), -- Marcus
  ('ff000006-0000-0000-0000-000000000006', 1,  6, 0, 0), -- Lily
  ('aa000007-0000-0000-0000-000000000007', 1,  4, 0, 0), -- Derek
  ('bb000008-0000-0000-0000-000000000008', 1,  3, 0, 0), -- Alyssa
  ('cc000009-0000-0000-0000-000000000009', 1,  4, 0, 0), -- Tyler
  -- Week 2
  ('aa000001-0000-0000-0000-000000000001', 2,  4, 0, 0),
  ('bb000002-0000-0000-0000-000000000002', 2,  8, 0, 0),
  ('cc000003-0000-0000-0000-000000000003', 2,  7, 0, 0),
  ('dd000004-0000-0000-0000-000000000004', 2,  6, 0, 0),
  ('ee000005-0000-0000-0000-000000000005', 2,  5, 0, 0),
  ('ff000006-0000-0000-0000-000000000006', 2,  5, 0, 0),
  ('aa000007-0000-0000-0000-000000000007', 2,  4, 0, 0),
  ('bb000008-0000-0000-0000-000000000008', 2,  4, 0, 0),
  ('cc000009-0000-0000-0000-000000000009', 2,  0, 0,-1), -- Tyler missed LOTW wk2
  -- Week 3
  ('aa000001-0000-0000-0000-000000000001', 3,  7, 0, 0),
  ('bb000002-0000-0000-0000-000000000002', 3,  7, 0, 0),
  ('cc000003-0000-0000-0000-000000000003', 3,  3, 0, 0),
  ('dd000004-0000-0000-0000-000000000004', 3,  6, 0, 0),
  ('ee000005-0000-0000-0000-000000000005', 3,  7, 0, 0),
  ('ff000006-0000-0000-0000-000000000006', 3,  3, 0, 0),
  ('aa000007-0000-0000-0000-000000000007', 3,  3, 0, 0),
  ('bb000008-0000-0000-0000-000000000008', 3,  1, 0, 0),
  ('cc000009-0000-0000-0000-000000000009', 3,  2, 0,-1)  -- Tyler missed LOTW wk3
ON CONFLICT (member_id, week_id) DO NOTHING;

-- Week 4: compute from picks we just inserted
INSERT INTO public.weekly_scores (member_id, week_id, pick_points, forfeit_penalty, lotw_penalty)
SELECT
  member_id,
  4,
  SUM(points) FILTER (WHERE points IS NOT NULL),
  0,
  0
FROM public.picks
WHERE week_id = 4
GROUP BY member_id
ON CONFLICT (member_id, week_id) DO UPDATE
  SET pick_points = EXCLUDED.pick_points;

-- Week 5: compute from picks on FINAL games only
INSERT INTO public.weekly_scores (member_id, week_id, pick_points, forfeit_penalty, lotw_penalty)
SELECT
  member_id,
  5,
  COALESCE(SUM(points) FILTER (WHERE points IS NOT NULL), 0),
  0,
  0
FROM public.picks
WHERE week_id = 5
GROUP BY member_id
ON CONFLICT (member_id, week_id) DO UPDATE
  SET pick_points = EXCLUDED.pick_points;

COMMIT;

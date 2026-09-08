## ADDED Requirements

### Requirement: Wager grading

The system SHALL grade every wager as `WIN`, `LOSS` or `PUSH` from the game's final scores
and the member's own line. Grading SHALL be defined as:

- For `ML` and `SPREAD`: compare `selected side's score + line` against the opposing side's
  score. Greater is a `WIN`, less is a `LOSS`, equal is a `PUSH`.
- For `TOTAL`: compare the sum of both scores against the line. Above the line the `OVER`
  wins and the `UNDER` loses; below the line the reverse; exactly on the line is a `PUSH`.

Because `ML` always carries a line of 0, a moneyline is graded by the same comparison as a
spread and SHALL NOT have a separate rule.

Grading SHALL depend only on the wager and the final scores, so that re-grading an unchanged
result always produces the same outcome.

#### Scenario: Favourite covers

- **WHEN** a member takes the home team at -7 and the game ends 31-17
- **THEN** the wager grades `WIN`, because 31 - 7 = 24 exceeds 17

#### Scenario: Favourite wins but fails to cover

- **WHEN** a member takes the home team at -7 and the game ends 24-20
- **THEN** the wager grades `LOSS`, because 24 - 7 = 17 is less than 20

#### Scenario: Underdog covers without winning

- **WHEN** a member takes the away team at +7 and the game ends 24-20 in the home team's
  favour
- **THEN** the wager grades `WIN`, because 20 + 7 = 27 exceeds 24

#### Scenario: Margin lands exactly on the spread

- **WHEN** a member takes a team at -7 and that team wins by exactly 7
- **THEN** the wager grades `PUSH`

#### Scenario: Moneyline

- **WHEN** a member takes a team `ML` and that team wins by any margin
- **THEN** the wager grades `WIN`

#### Scenario: Moneyline on a tied game

- **WHEN** a member takes a team `ML` and the game ends tied
- **THEN** the wager grades `PUSH`

#### Scenario: Total goes over

- **WHEN** a member takes `OVER 52.5` and the game ends 30-27
- **THEN** the wager grades `WIN`, because the 57 points scored exceed 52.5

#### Scenario: Total lands exactly on the number

- **WHEN** a member takes `OVER 52` or `UNDER 52` and the game ends 28-24
- **THEN** the wager grades `PUSH`, because the 52 points scored equal the line

## MODIFIED Requirements

### Requirement: Regular pick scoring

The system SHALL award points for each regular (non-LOTW) wager according to its grade: +1
for a `WIN`, 0 for a `PUSH`, -1 for a `LOSS`. Point values are unchanged from straight-up
scoring; only the determination of the grade differs (see "Wager grading").

Members SHALL be scored against their own line. Two members holding different lines on the
same game MAY receive different points from the same final score.

#### Scenario: Member's wager wins (regular)

- **WHEN** a wager grades `WIN` and is not LOTW
- **THEN** the member is awarded +1 point for that wager

#### Scenario: Member's wager loses (regular)

- **WHEN** a wager grades `LOSS` and is not LOTW
- **THEN** the member is awarded -1 point for that wager

#### Scenario: Wager pushes (regular)

- **WHEN** a wager grades `PUSH` and is not LOTW
- **THEN** the member is awarded 0 points for that wager

#### Scenario: Same game, different lines, different results

- **WHEN** one member holds a team at -3 and another holds the same team at -4, and that team
  wins by exactly 3
- **THEN** the first member's wager grades `PUSH` for 0 points and the second's grades `LOSS`
  for -1

---

### Requirement: Lock of the Week (LOTW) scoring

The system SHALL apply double points to the wager designated as the member's LOTW: +2 for a
`WIN`, 0 for a `PUSH`, -2 for a `LOSS`. The LOTW designation SHALL be independent of bet
type — a member MAY lock a moneyline, a spread, or a total.

#### Scenario: Member wins their LOTW wager

- **WHEN** a wager grades `WIN` and is flagged as LOTW
- **THEN** the member is awarded +2 points for that wager

#### Scenario: Member loses their LOTW wager

- **WHEN** a wager grades `LOSS` and is flagged as LOTW
- **THEN** the member is awarded -2 points for that wager

#### Scenario: LOTW wager pushes

- **WHEN** a wager grades `PUSH` and is flagged as LOTW
- **THEN** the member is awarded 0 points for that wager

---

### Requirement: Scoring recalculation on result change

The system SHALL recalculate all affected wager scores whenever an admin changes or corrects
a game's final scores. Because members hold different lines, a correction SHALL re-grade
every wager on that game individually rather than applying one outcome to all of them.
Leaderboard totals SHALL update immediately after recalculation.

#### Scenario: Admin corrects a game's score

- **WHEN** an ADMIN changes a game's final scores
- **THEN** the system re-grades every wager on that game against the corrected scores and
  updates weekly and season totals accordingly

#### Scenario: Correction changes some members' results but not others

- **WHEN** a corrected score moves the margin across one member's line but not another's
- **THEN** only the affected member's points change; the other member's wager keeps its
  original grade

#### Scenario: Multiple members affected by a result change

- **WHEN** a game's scores change and multiple members had wagers on that game
- **THEN** all affected members' scores are recalculated in the same operation

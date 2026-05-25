## ADDED Requirements

### Requirement: Regular pick scoring
The system SHALL award points for each regular (non-LOTW) pick according to the result: +1 for a WIN, 0 for a PUSH, -1 for a LOSS.

#### Scenario: Member picks the winning team (regular)
- **WHEN** the game result is marked WIN for the team a member picked, and the pick is not LOTW
- **THEN** the member is awarded +1 point for that pick

#### Scenario: Member picks the losing team (regular)
- **WHEN** the game result is marked WIN for the opposing team, and the pick is not LOTW
- **THEN** the member is awarded -1 point for that pick

#### Scenario: Game ends in a push (regular)
- **WHEN** the game result is marked PUSH and the pick is not LOTW
- **THEN** the member is awarded 0 points for that pick

---

### Requirement: Lock of the Week (LOTW) scoring
The system SHALL apply double points to the pick designated as the member's LOTW: +2 for a WIN, 0 for a PUSH, -2 for a LOSS.

#### Scenario: Member wins their LOTW pick
- **WHEN** the game result is marked WIN for the team a member picked, and the pick is flagged as LOTW
- **THEN** the member is awarded +2 points for that pick

#### Scenario: Member loses their LOTW pick
- **WHEN** the game result is marked WIN for the opposing team, and the pick is flagged as LOTW
- **THEN** the member is awarded -2 points for that pick

#### Scenario: LOTW game ends in a push
- **WHEN** the game result is marked PUSH and the pick is flagged as LOTW
- **THEN** the member is awarded 0 points for that pick

---

### Requirement: Forfeit penalty at week close
The system SHALL apply a -1 point penalty for each pick slot a member did not fill, calculated at the moment the admin closes the week. Forfeits are not applied game-by-game as games lock.

#### Scenario: Member made fewer picks than required
- **WHEN** the admin closes the week and a member has 7 picks against a required count of 10
- **THEN** the member receives -3 forfeit penalty points (one per unfilled slot)

#### Scenario: Member made exactly the required number of picks
- **WHEN** the admin closes the week and a member's pick count equals the required count
- **THEN** no forfeit penalty is applied

#### Scenario: Member made more picks than required
- **WHEN** a member has picks equal to the required count (the UI prevents exceeding the limit)
- **THEN** no forfeit penalty applies; this scenario should not occur in practice

---

### Requirement: LOTW missing penalty at week close
The system SHALL apply a -1 point penalty if a member has no LOTW designation at the time the week is closed. This is separate from and additive to any forfeit penalties.

#### Scenario: No LOTW designated at week close
- **WHEN** the admin closes the week and a member has no pick flagged as LOTW
- **THEN** the member receives an additional -1 point LOTW missing penalty

#### Scenario: LOTW designated before week close
- **WHEN** the admin closes the week and a member has exactly one pick flagged as LOTW
- **THEN** no LOTW missing penalty is applied

#### Scenario: Admin assigns LOTW before week close
- **WHEN** an ADMIN assigns an LOTW designation to a member who has none, before the week is closed
- **THEN** no LOTW missing penalty is applied; the admin-assigned LOTW is scored normally

---

### Requirement: Scoring recalculation on result change
The system SHALL recalculate all affected pick scores whenever an admin changes or corrects a game result. Leaderboard totals SHALL update immediately after recalculation.

#### Scenario: Admin corrects a game result
- **WHEN** an ADMIN changes a game's result from LOSS to WIN (or any other change)
- **THEN** the system recalculates points for every pick on that game and updates weekly and season totals accordingly

#### Scenario: Multiple members affected by result change
- **WHEN** a game result changes and multiple members had picks on that game
- **THEN** all affected members' scores are recalculated in the same operation

---

### Requirement: Weekly and season totals
The system SHALL maintain a weekly point total and a cumulative season total for each member. Season total is the sum of all weekly totals for games in the same season.

#### Scenario: Week total calculation
- **WHEN** game results are entered and forfeits/penalties are applied at week close
- **THEN** a member's weekly total equals the sum of all pick points plus all penalty points for that week

#### Scenario: Season total calculation
- **WHEN** a member's weekly total for a closed week is finalized
- **THEN** the season total is updated to reflect the sum of all closed weeks in the current season

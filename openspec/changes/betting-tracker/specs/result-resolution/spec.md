## ADDED Requirements

### Requirement: Admin marks game results manually (Day 1)
The system SHALL provide an admin interface for marking each game's result as a HOME win, AWAY win, or PUSH. Marking a result triggers immediate scoring recalculation for all picks on that game.

#### Scenario: Admin marks a game as HOME win
- **WHEN** an ADMIN selects HOME WIN for a game
- **THEN** the game status is set to FINAL, the winner field is set to HOME, and scoring recalculation runs for all picks on that game

#### Scenario: Admin marks a game as AWAY win
- **WHEN** an ADMIN selects AWAY WIN for a game
- **THEN** the game status is set to FINAL, the winner field is set to AWAY, and scoring recalculation runs for all picks on that game

#### Scenario: Admin marks a game as a push
- **WHEN** an ADMIN selects PUSH for a game
- **THEN** the game status is set to FINAL, the winner field is set to PUSH, and all picks on that game receive 0 points

---

### Requirement: Admin can correct a previously entered result
The system SHALL allow an ADMIN to change a game's result after it has been marked FINAL. The system SHALL warn the admin that this will trigger a full scoring recalculation and require explicit confirmation.

#### Scenario: Admin corrects a result
- **WHEN** an ADMIN changes the result of a FINAL game after confirming the recalculation warning
- **THEN** the game result is updated, scoring is recalculated for all picks on that game, and weekly and season totals are updated

#### Scenario: Admin cancels a result correction
- **WHEN** an ADMIN dismisses the confirmation warning without confirming
- **THEN** the game result is unchanged and no recalculation occurs

---

### Requirement: Game status lifecycle
Every game SHALL have a status that progresses through defined states. Status transitions drive UI display and pick lock behavior.

#### Scenario: Game status transitions forward
- **WHEN** a game moves from SCHEDULED → LIVE → FINAL
- **THEN** the UI reflects each status change and pick editing is blocked once status leaves SCHEDULED

#### Scenario: Game postponed
- **WHEN** an ADMIN marks a game as POSTPONED
- **THEN** picks on that game are unfrozen (members can edit them again), and the game is excluded from forfeit count calculations until rescheduled or cancelled

#### Scenario: Postponed game rescheduled
- **WHEN** an ADMIN updates a postponed game with a new kickoff time
- **THEN** the game status returns to SCHEDULED and picks re-lock at the new kickoff time

#### Scenario: Postponed game cancelled
- **WHEN** an ADMIN marks a postponed game as CANCELLED
- **THEN** all picks on that game receive 0 points and the game is excluded from the required pick count for that week

---

### Requirement: Day 2 API result hook (scaffolded)
The system schema SHALL include an `resolution_mode` field on each game (MANUAL | API) and retain the `external_id` field so that automated result resolution can be added in a future release without a database migration.

#### Scenario: resolution_mode field exists on game record
- **WHEN** a game record is created via schedule sync
- **THEN** the game record includes a `resolution_mode` field defaulting to MANUAL and an `external_id` referencing the source API

#### Scenario: Future automated resolution
- **WHEN** automated resolution is implemented in Day 2
- **THEN** games with `resolution_mode = API` are resolved by the external system; games with `resolution_mode = MANUAL` continue to require admin input

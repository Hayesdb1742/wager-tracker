## ADDED Requirements

### Requirement: Blind picks before kickoff
The system SHALL hide all members' picks from other members until the game's kickoff time has passed. This is enforced at the database layer via Row-Level Security, not only in the UI.

#### Scenario: Member views leaderboard before any game kicks off
- **WHEN** a member views the leaderboard or another member's profile before any game in the week has kicked off
- **THEN** the member sees standings and point totals but cannot see which teams any other member picked

#### Scenario: Member views picks after game kicks off
- **WHEN** a member views picks for a game after its kickoff time has passed
- **THEN** all members' picks for that specific game are visible

#### Scenario: Direct API call to read another member's pre-kickoff pick
- **WHEN** any client sends a direct API or database query to read another member's pick for a game that has not kicked off
- **THEN** the database Row-Level Security policy returns no rows for that pick

---

### Requirement: Admin sees all picks at all times
An ADMIN SHALL be able to view every member's picks for every game regardless of kickoff status. This applies to both the UI and the underlying database queries.

#### Scenario: Admin views pre-kickoff picks
- **WHEN** an ADMIN navigates to the admin pick overview screen before any games have kicked off
- **THEN** all members' picks, including LOTW designations, are visible in a grid or table view

#### Scenario: Admin views a specific member's full week pick sheet
- **WHEN** an ADMIN selects a specific member's name
- **THEN** the full pick sheet for that member — all games, selections, and LOTW — is displayed

---

### Requirement: Admin can override any member's pick
An ADMIN SHALL be able to change any member's pick for any game, including games that have already kicked off, subject to the game result not yet being finalized. Overrides are recorded with a full audit trail.

#### Scenario: Admin overrides a pre-kickoff pick
- **WHEN** an ADMIN changes a member's pick before the game has kicked off
- **THEN** the pick is updated to the new selection, and the override is logged with the admin's ID and timestamp

#### Scenario: Admin overrides a post-kickoff pick before result is final
- **WHEN** an ADMIN changes a member's pick after game kickoff but before the result has been entered
- **THEN** the pick is updated and logged; the member's points for that game will be calculated using the overridden pick

#### Scenario: Admin attempts to override a pick on a finalized game
- **WHEN** an ADMIN attempts to change a pick for a game whose result is already marked FINAL
- **THEN** the system warns the admin that the game result is final and overriding will trigger a scoring recalculation, requiring explicit confirmation

#### Scenario: Member views their own overridden pick
- **WHEN** a member views their pick sheet and one of their picks has been overridden by an admin
- **THEN** the member sees the current (overridden) pick and a notation that it was modified by the admin, with the timestamp

---

### Requirement: Override audit log
The system SHALL maintain an immutable audit log of all admin pick overrides. Each log entry SHALL record: which pick was changed, the previous value, the new value, the admin who made the change, and the timestamp.

#### Scenario: Admin overrides a pick
- **WHEN** an ADMIN overrides a member's pick
- **THEN** a new audit log entry is created and the original pick value is preserved in the log

#### Scenario: Pick overridden multiple times
- **WHEN** a pick is overridden more than once
- **THEN** each override creates a separate audit log entry; the full history is accessible to ADMIN users

## ADDED Requirements

### Requirement: Member views available games for the week
The system SHALL display all games in the current week's pick pool to the authenticated member, grouped by sport and sorted by kickoff time ascending. Locked games (kickoff has passed) SHALL be visually distinguished from editable games.

#### Scenario: Active week with mixed lock states
- **WHEN** a member opens the pick entry screen during an active week
- **THEN** games that have not yet kicked off are shown as editable; games that have kicked off are shown as locked with their pick frozen

#### Scenario: No active week
- **WHEN** a member opens the pick entry screen and no week is currently open
- **THEN** the system displays a message indicating picks are not yet open for the next week

---

### Requirement: Member selects a team for each game they wish to pick
The system SHALL allow a member to select either the home team or away team for any game in the pool. A member is not required to pick every game; unpicked games within the required count become forfeits at week close.

#### Scenario: Member picks a team
- **WHEN** a member selects a team for a game
- **THEN** the pick is saved immediately and the game shows as picked with the selected team highlighted

#### Scenario: Member changes their pick before kickoff
- **WHEN** a member selects a different team for a game they have already picked, before that game's kickoff
- **THEN** the pick is updated to the new team and saved

#### Scenario: Member attempts to change pick after kickoff
- **WHEN** a member attempts to modify a pick for a game whose kickoff time has passed
- **THEN** the system rejects the change server-side and displays a "pick locked" message

---

### Requirement: Exactly one Lock of the Week (LOTW) per member per week
Every member MUST designate exactly one of their picks as their Lock of the Week. The LOTW selection can be changed at any time before the designated game's kickoff. The LOTW cannot be placed on a game that has already locked.

#### Scenario: Member designates an LOTW
- **WHEN** a member marks a picked game as their LOTW
- **THEN** that game is flagged as LOTW and any previous LOTW designation for the week is cleared

#### Scenario: Member attempts to move LOTW to a locked game
- **WHEN** a member attempts to designate a game that has already kicked off as their LOTW
- **THEN** the system rejects the action and displays a message that LOTW cannot be placed on a locked game

#### Scenario: Member's LOTW game locks before all picks lock
- **WHEN** the game a member designated as LOTW kicks off
- **THEN** the LOTW designation is frozen on that game; the member cannot move it to another game even if other games are still editable

#### Scenario: Week ends with no LOTW designated
- **WHEN** the week closes and a member has no LOTW designated
- **THEN** the scoring engine applies the LOTW missing penalty (see scoring-engine spec)

---

### Requirement: Pick count tracking
The system SHALL display to the member how many picks they have made versus the week's required pick count, and how many LOTW slots remain unset.

#### Scenario: Member at required pick count
- **WHEN** a member's pick count equals the week's required pick count
- **THEN** the UI shows "10 / 10 picks made" (or equivalent) and does not prevent further picks if the member wishes to replace an existing one

#### Scenario: Member below required pick count at kickoff of their last game
- **WHEN** a member's last available game kicks off and they have fewer picks than required
- **THEN** the system displays a warning showing how many forfeit penalties will apply at week close

---

### Requirement: Picks are saved immediately on selection
The system SHALL persist each pick the moment the member makes a selection. There is no separate "submit" button. Partial pick states are valid and preserved across sessions.

#### Scenario: Member closes browser mid-pick
- **WHEN** a member has made some picks and closes the browser without explicit action
- **THEN** all picks made up to that point are saved and visible when the member returns

#### Scenario: Pick save fails due to network error
- **WHEN** a pick cannot be saved due to a connectivity issue
- **THEN** the system displays an error indicator on that game and retries automatically; the member is not silently left with an unsaved pick

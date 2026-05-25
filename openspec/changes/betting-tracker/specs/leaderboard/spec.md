## ADDED Requirements

### Requirement: Weekly leaderboard
The system SHALL display a weekly leaderboard ranking all active members by their point total for the current week. The leaderboard updates in real time as game results are entered by the admin.

#### Scenario: Leaderboard reflects latest results
- **WHEN** an admin marks a game result
- **THEN** the leaderboard updates within seconds for all members currently viewing it, without requiring a page refresh

#### Scenario: Leaderboard with no results yet entered
- **WHEN** a member views the weekly leaderboard before any games have been resolved
- **THEN** all members are shown with 0 points and ranked alphabetically as a tiebreaker

#### Scenario: Tiebreaker on equal points
- **WHEN** two or more members have the same weekly point total
- **THEN** they share the same rank and are sorted alphabetically within the tie

---

### Requirement: Weekly leaderboard display columns
The weekly leaderboard SHALL show, for each member: rank, display name, wins, losses, pushes, and total weekly points. LOTW result SHALL be visually indicated.

#### Scenario: Member with LOTW win displayed
- **WHEN** a member's LOTW pick has been resolved as a WIN
- **THEN** the leaderboard shows a distinct indicator (e.g., a lock icon) next to their name or points

#### Scenario: Member with forfeits displayed
- **WHEN** the week has been closed and a member has forfeit penalties
- **THEN** the forfeit count and associated point deduction are shown in the member's row

---

### Requirement: Season leaderboard
The system SHALL display a season leaderboard ranking all active members by their cumulative point total across all closed weeks in the current season.

#### Scenario: Season leaderboard after multiple weeks
- **WHEN** a member views the season leaderboard after three weeks have been closed
- **THEN** each member's total reflects the sum of all three weeks' final point totals

#### Scenario: In-progress week excluded from season total
- **WHEN** the current week is still open (not yet closed by admin)
- **THEN** the season leaderboard reflects only closed weeks; the in-progress week's points are shown separately as "this week"

---

### Requirement: Prior week leaderboard archive
The system SHALL allow members to view the final leaderboard for any past week in the current season, and for past seasons.

#### Scenario: Member views a prior week
- **WHEN** a member selects a past week from a dropdown or calendar
- **THEN** the leaderboard for that week is displayed with final standings and all resolved results

#### Scenario: Member views a prior season
- **WHEN** a member navigates to a prior season
- **THEN** the season leaderboard for that year is displayed with final standings

---

### Requirement: Pick result visibility on leaderboard
After a game has kicked off, the leaderboard SHALL reveal each member's pick result for that game inline, so members can see in real time who won and lost on each game.

#### Scenario: Game kicked off, result not yet entered
- **WHEN** a game's kickoff time has passed but no result has been entered
- **THEN** picks for that game are visible to all members but shown as PENDING

#### Scenario: Game result entered
- **WHEN** an admin marks a game result
- **THEN** each member's pick for that game updates to WIN, LOSS, or PUSH in real time

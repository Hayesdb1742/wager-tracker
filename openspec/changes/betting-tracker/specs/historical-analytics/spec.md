## ADDED Requirements

### Requirement: All-time season standings
The system SHALL display a cumulative all-time standings table showing each member's total points, total weeks played, and overall win/loss/push record across every completed season.

#### Scenario: Member views all-time standings
- **WHEN** a member navigates to the historical analytics section
- **THEN** a table displays all members ranked by all-time total points, with columns for seasons played, total picks, W-L-P record, and win percentage

#### Scenario: New member added mid-season
- **WHEN** a member joins the league after the season has started
- **THEN** their all-time record reflects only the weeks they participated in; prior weeks show no data for that member

---

### Requirement: Per-member statistics
The system SHALL provide a detailed stats page for each member showing their individual performance history.

#### Scenario: Member views their own stats page
- **WHEN** a member navigates to their profile or stats view
- **THEN** they see: overall W-L-P record, win percentage, LOTW win percentage, best single week (most points), worst single week (fewest points), longest winning streak, longest losing streak, and total season points per season

#### Scenario: Member views another member's stats page
- **WHEN** a member navigates to another member's stats page
- **THEN** the same statistics are shown; no private data (email addresses, etc.) is exposed

---

### Requirement: Team pick tendencies
The system SHALL track and display which teams each member picks most frequently, and that member's win/loss record when picking each team.

#### Scenario: Member views their team tendencies
- **WHEN** a member views their stats page
- **THEN** a table shows the top teams they have picked (by pick count), with win percentage for each team

#### Scenario: League-wide team tendencies
- **WHEN** a member views the league analytics page
- **THEN** a table shows the most-picked teams across all members and the collective win percentage when the league picks each team

---

### Requirement: Head-to-head records
The system SHALL provide a head-to-head comparison showing how two members have performed against each other — i.e., in weeks where both played, who scored more points.

#### Scenario: Member views head-to-head against another member
- **WHEN** a member selects another member for head-to-head comparison
- **THEN** the system displays: weeks played head-to-head, wins/losses/ties (by weekly score), and the point differential across all shared weeks

---

### Requirement: Season-by-season breakdown
The system SHALL allow members to browse results broken down by season, showing weekly scores and the final season standings for any completed season.

#### Scenario: Member views a completed season
- **WHEN** a member selects a past season
- **THEN** the final season standings are displayed along with a week-by-week point breakdown for each member

#### Scenario: Member views current season in progress
- **WHEN** a member views the current season
- **THEN** the standings reflect all closed weeks, clearly indicating which weeks are final and which is in progress

---

### Requirement: LOTW performance tracking
The system SHALL track and display each member's LOTW pick history — how often they win, lose, and push on their LOTW designations.

#### Scenario: Member views LOTW history
- **WHEN** a member views their stats page
- **THEN** a section shows their LOTW record (W-L-P), LOTW win percentage, and a list of recent LOTW picks with outcomes

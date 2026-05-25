## ADDED Requirements

### Requirement: Admin creates a new week
The system SHALL allow an ADMIN to create a new week for the current season by setting the week number, required pick count, and the dates the week opens and closes.

#### Scenario: Admin creates a valid week
- **WHEN** an ADMIN submits a new week with a week number, required pick count (e.g., 10), opens_at date, and closes_at date
- **THEN** the week is created with status OPEN and becomes available for schedule sync and member picks

#### Scenario: Admin attempts to create a duplicate week number
- **WHEN** an ADMIN submits a week number that already exists in the current season
- **THEN** the system rejects the creation and displays an error

#### Scenario: Week created with auto-close scaffolding
- **WHEN** a week is created
- **THEN** the week record includes an `auto_close_at` field (nullable, defaults to null) and a `close_mode` field (MANUAL | AUTO, defaults to MANUAL), supporting future automation without a migration

---

### Requirement: Admin closes a week
Closing a week is a manual admin action that finalizes scores for that week: it triggers forfeit penalty calculation and the LOTW missing penalty check. Once closed, a week cannot be reopened without admin confirmation.

#### Scenario: Admin closes the week
- **WHEN** an ADMIN clicks "Close Week" and confirms the action
- **THEN** the week status changes to CLOSED, forfeit penalties are applied to all members below the required pick count, and LOTW missing penalties are applied to all members without an LOTW designation

#### Scenario: Admin attempts to close a week with unresolved games
- **WHEN** an ADMIN attempts to close a week that still has games in SCHEDULED or LIVE status
- **THEN** the system warns the admin that unresolved games remain and lists them, requiring explicit confirmation before proceeding

#### Scenario: Admin reopens a closed week
- **WHEN** an ADMIN attempts to reopen a CLOSED week
- **THEN** the system warns that forfeit and penalty points will be reversed and recalculated on next close, requiring explicit confirmation

---

### Requirement: Admin assigns a member's LOTW
The system SHALL allow an ADMIN to manually assign or change an LOTW designation for any member on any pick, provided the week is not yet closed.

#### Scenario: Admin assigns LOTW for a member who missed it
- **WHEN** an ADMIN assigns an LOTW to a member's existing pick before the week is closed
- **THEN** the pick is flagged as LOTW and the LOTW missing penalty will not be applied to that member at week close

#### Scenario: Admin assigns LOTW to a member who already has one
- **WHEN** an ADMIN assigns an LOTW to a pick for a member who already has a different pick flagged as LOTW
- **THEN** the previous LOTW flag is cleared and the new pick is flagged, maintaining the one-LOTW-per-member-per-week constraint

#### Scenario: Admin attempts LOTW assignment after week close
- **WHEN** an ADMIN attempts to assign an LOTW after the week status is CLOSED
- **THEN** the system rejects the action and informs the admin the week is closed

---

### Requirement: Admin invites new members
The system SHALL allow an ADMIN to generate an invite link for a new member by entering their email address. Invite links are single-use and expire after 72 hours.

#### Scenario: Admin generates an invite
- **WHEN** an ADMIN enters an email address and clicks "Send Invite"
- **THEN** the system generates a unique invite link, records the invited email and expiry time, and sends the magic link to the provided email

#### Scenario: Admin invites an email already in the system
- **WHEN** an ADMIN attempts to invite an email address that belongs to an existing active member
- **THEN** the system rejects the invite and displays an error

#### Scenario: Invite expires unused
- **WHEN** 72 hours pass without the invite link being clicked
- **THEN** the invite is marked expired and cannot be used to create an account

---

### Requirement: Admin views all members' pick status for the current week
The system SHALL provide an admin dashboard view showing every member's pick completion status for the current week: how many picks they have made, whether they have set an LOTW, and which games they have locked picks on.

#### Scenario: Admin views pick status overview
- **WHEN** an ADMIN opens the week pick status dashboard
- **THEN** a table shows each member with columns for: picks made, picks required, LOTW set (yes/no), and number of locked picks

#### Scenario: Admin identifies members at risk of forfeits
- **WHEN** an ADMIN views the pick status dashboard with some games already locked
- **THEN** members who have fewer picks than required and whose available games are running out are visually flagged

---

### Requirement: Admin manages the pick pool
The system SHALL allow an ADMIN to include or exclude individual games from the week's pick pool at any time before all games in that week have kicked off.

#### Scenario: Admin excludes a game with no picks
- **WHEN** an ADMIN excludes a game that no member has picked
- **THEN** the game is removed from the member pick entry screen immediately

#### Scenario: Admin excludes a game that has existing picks
- **WHEN** an ADMIN excludes a game that one or more members have already picked
- **THEN** the system warns the admin how many members will have their pick orphaned and requires confirmation before proceeding; orphaned picks are treated as forfeits

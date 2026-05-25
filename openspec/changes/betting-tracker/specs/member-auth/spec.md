## ADDED Requirements

### Requirement: Invite-only registration
The system SHALL restrict account creation to members who have received an admin-generated invite link. There is no public sign-up flow.

#### Scenario: Valid invite link used
- **WHEN** a user opens a valid, unexpired invite link
- **THEN** the system presents a field to enter their display name and sends a magic link to the invited email address

#### Scenario: Expired or invalid invite link used
- **WHEN** a user opens an invite link that is expired or has already been used
- **THEN** the system displays an error message and does not allow account creation

#### Scenario: Invite link already consumed
- **WHEN** a user opens an invite link for an email that already has an active account
- **THEN** the system displays an error and directs them to log in instead

---

### Requirement: Magic link authentication
The system SHALL authenticate members via a one-time email magic link. No passwords are stored or required.

#### Scenario: Member requests login
- **WHEN** a member enters their email on the login screen
- **THEN** the system sends a one-time magic link to that email valid for 1 hour

#### Scenario: Member clicks valid magic link
- **WHEN** a member clicks a valid, unexpired magic link
- **THEN** the system creates an authenticated session and redirects them to the pick entry screen

#### Scenario: Member clicks expired magic link
- **WHEN** a member clicks a magic link older than 1 hour
- **THEN** the system displays an expiry message and offers to send a new link

#### Scenario: Unregistered email used
- **WHEN** a user enters an email that has no account
- **THEN** the system SHALL NOT reveal whether the email exists; it displays a generic "check your email" message

---

### Requirement: Member roles
The system SHALL assign each member exactly one role: ADMIN or MEMBER. Role determines what actions and views are accessible.

#### Scenario: MEMBER accesses admin-only screen
- **WHEN** a MEMBER navigates to an admin-only route
- **THEN** the system returns a 403 and redirects to the member dashboard

#### Scenario: ADMIN accesses all screens
- **WHEN** an ADMIN navigates to any route in the application
- **THEN** the system grants access without restriction

#### Scenario: Role checked server-side
- **WHEN** any privileged API action is called
- **THEN** the system SHALL verify the caller's role server-side regardless of what the client sent

---

### Requirement: Session persistence
The system SHALL maintain an authenticated session across browser closes for a rolling 30-day window. Sessions expire after 30 days of inactivity.

#### Scenario: Member returns after short absence
- **WHEN** a member revisits the app within 30 days of their last activity
- **THEN** the system restores their session without requiring a new magic link

#### Scenario: Session expired
- **WHEN** a member revisits the app after 30 days of inactivity
- **THEN** the system clears the session and redirects to the login screen

---

### Requirement: Admin can deactivate members
The system SHALL allow an ADMIN to deactivate a member account. Deactivated members cannot log in or submit picks, but their historical data is preserved.

#### Scenario: Admin deactivates a member
- **WHEN** an ADMIN deactivates a member account
- **THEN** the member's active session is revoked and they cannot log in until reactivated

#### Scenario: Deactivated member's history preserved
- **WHEN** a member is deactivated
- **THEN** all historical picks, scores, and leaderboard entries for that member remain visible in the app

## MODIFIED Requirements

### Requirement: Member selects a team for each game they wish to pick

The system SHALL allow a member to record a **wager** on any game in the pool. A wager
consists of a bet type, a selection, a line, and an optional price:

| Bet type | Selection | Line |
|---|---|---|
| `ML` | `HOME` or `AWAY` | MUST be 0 |
| `SPREAD` | `HOME` or `AWAY` | any number, including 0 for a pick'em |
| `TOTAL` | `OVER` or `UNDER` | MUST be greater than 0 |

The line SHALL be entered by the member and SHALL be stored from the perspective of the
selected side — a member taking a team as a 3.5-point underdog stores `+3.5`, and as a
3.5-point favourite stores `-3.5`. The system SHALL NOT source lines from a provider and
SHALL NOT verify a member's line against one.

The price, when given, SHALL be recorded as American odds. The system SHALL reject a price
between -100 and +100 exclusive, as no such price exists. The system SHALL NOT otherwise
restrict the price in this release.

A member MAY hold at most one wager per game. A member is not required to wager on every
game; unwagered slots within the required count become forfeits at week close.

#### Scenario: Member records a spread wager

- **WHEN** a member selects `SPREAD`, takes the home team, and enters a line of -7
- **THEN** the wager is saved with `bet_type = SPREAD`, `selection = HOME`, `line = -7`

#### Scenario: Member records a total

- **WHEN** a member selects `TOTAL`, takes the over, and enters 52.5
- **THEN** the wager is saved with `bet_type = TOTAL`, `selection = OVER`, `line = 52.5`

#### Scenario: Member records a moneyline

- **WHEN** a member selects `ML` and takes the away team
- **THEN** the wager is saved with `bet_type = ML`, `selection = AWAY`, `line = 0`

#### Scenario: Selection does not belong to the bet type

- **WHEN** a wager arrives with `bet_type = TOTAL` and `selection = HOME`, or with
  `bet_type = SPREAD` and `selection = OVER`
- **THEN** the system rejects it server-side and the wager is not saved

#### Scenario: Total submitted without a line

- **WHEN** a member selects `TOTAL` and `OVER` but enters no number, or enters 0
- **THEN** the system rejects the wager and prompts for the total

#### Scenario: Member changes their wager before kickoff

- **WHEN** a member changes the bet type, selection, line, or price of an existing wager
  before that game's kickoff
- **THEN** the wager is updated in place and the change is recorded in the audit log

#### Scenario: Member attempts to change a wager after kickoff

- **WHEN** a member attempts to modify a wager for a game whose kickoff time has passed
- **THEN** the system rejects the change server-side and displays a "pick locked" message

#### Scenario: Two members take different numbers on the same game

- **WHEN** one member takes a team at -3.5 and another takes the same team at -4 in the same
  game
- **THEN** both wagers are stored with their own lines and are graded independently

---

### Requirement: Picks are saved immediately on selection

The system SHALL persist a wager as soon as it is **complete and valid** — a bet type, a
selection, and a line consistent with that type. A wager that is still being composed SHALL
NOT be persisted; in particular a partially typed line, such as a lone minus sign or a
trailing decimal point, SHALL NOT be sent to the server.

There is no separate "submit" button. Partial pick states across the week are valid and
preserved between sessions: a member may wager on some games and not others.

#### Scenario: Member is midway through typing a line

- **WHEN** a member has selected `SPREAD` and the home team, and has typed only `-`
- **THEN** no wager is saved and no request is sent

#### Scenario: Wager completed

- **WHEN** the member finishes typing a valid line
- **THEN** the wager is saved without any further action from the member, and the game shows
  as wagered

#### Scenario: Member closes browser mid-entry

- **WHEN** a member has saved some wagers and closes the browser without explicit action
- **THEN** every complete wager made up to that point is preserved and visible on return,
  and any incomplete one is discarded

#### Scenario: Save fails due to network error

- **WHEN** a wager cannot be saved due to a connectivity issue
- **THEN** the system displays an error indicator on that game and retries automatically;
  the member is not silently left with an unsaved wager

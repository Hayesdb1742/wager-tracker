## MODIFIED Requirements

### Requirement: Admin marks game results manually (Day 1)

The system SHALL provide an admin interface for entering a game's **final scores**. Entering
scores SHALL set the game status to FINAL, derive and store the straight-up winner
(`HOME`, `AWAY`, or `PUSH` for a tie) for display, and trigger grading of every wager on that
game.

Marking a winner alone SHALL NOT be sufficient to resolve a game. Members hold their own
spreads and totals, so a game cannot be graded without the scores themselves.

#### Scenario: Admin enters final scores

- **WHEN** an ADMIN enters a home score and an away score for a game
- **THEN** the game status is set to FINAL, the scores are stored, the straight-up winner is
  derived from them, and every wager on that game is graded

#### Scenario: Admin enters scores for a tied game

- **WHEN** an ADMIN enters equal home and away scores
- **THEN** the derived winner is PUSH, moneyline wagers on that game grade `PUSH`, and spread
  and total wagers are still graded against their own lines

#### Scenario: Admin submits an incomplete result

- **WHEN** an ADMIN submits a result with only one score, or with a negative score
- **THEN** the system rejects it and the game is not resolved

#### Scenario: Automated resolution supplies scores

- **WHEN** results sync resolves a game from the upstream provider
- **THEN** it supplies both final scores through the same path as manual entry, and wagers
  are graded identically

---

### Requirement: Admin can correct a previously entered result

The system SHALL allow an ADMIN to change a game's final scores after it has been marked
FINAL. The system SHALL warn the admin that this will re-grade every wager on the game and
require explicit confirmation.

#### Scenario: Admin corrects a result

- **WHEN** an ADMIN changes the final scores of a FINAL game after confirming the
  recalculation warning
- **THEN** the scores and derived winner are updated, every wager on that game is re-graded
  against its own line, and weekly and season totals are updated

#### Scenario: Admin cancels a result correction

- **WHEN** an ADMIN dismisses the confirmation warning without confirming
- **THEN** the scores are unchanged and no re-grading occurs

#### Scenario: Correction leaves the winner unchanged but moves the margin

- **WHEN** a corrected score keeps the same winning side but changes the margin of victory
- **THEN** wagers are still re-graded, because a spread or total result may have changed even
  though the straight-up winner did not

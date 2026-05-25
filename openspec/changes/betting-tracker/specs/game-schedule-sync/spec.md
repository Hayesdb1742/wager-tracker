## ADDED Requirements

### Requirement: Weekly CFB schedule pull
The system SHALL pull the full college football schedule for the upcoming week from the collegefootballdata.com (cfbd) API and store all games in the database.

#### Scenario: Successful CFB sync
- **WHEN** the sync job runs for a given week
- **THEN** all FBS games scheduled for that week are upserted into the games table with their teams, kickoff time, and cfbd external ID

#### Scenario: Sync run twice for same week
- **WHEN** the sync job runs more than once for the same week
- **THEN** no duplicate game records are created; existing records are updated in place using the external ID as the dedup key

#### Scenario: Game kickoff time changes after sync
- **WHEN** the sync job runs and a game's kickoff time has changed since the last sync
- **THEN** the stored kickoff time is updated to the new value

---

### Requirement: Weekly NFL schedule pull
The system SHALL pull the full NFL schedule for the upcoming week from the ESPN unofficial API and store all games in the database, using the same upsert logic as CFB.

#### Scenario: Successful NFL sync
- **WHEN** the sync job runs for a given week
- **THEN** all NFL games for that week are upserted with teams, kickoff time, and ESPN external ID

#### Scenario: NFL and CFB games stored together
- **WHEN** both CFB and NFL syncs run for the same week
- **THEN** all games are stored in a single games table with a `sport` field (NFL | CFB) to distinguish them

---

### Requirement: External ID deduplication
Every game record SHALL store the source API's external ID. This is the primary key used to prevent duplicates and to map back to the external system in Day 2 result resolution.

#### Scenario: Game already exists in database
- **WHEN** the sync job encounters a game whose external ID is already in the database
- **THEN** the system updates the existing record rather than inserting a new one

#### Scenario: New game encountered
- **WHEN** the sync job encounters a game whose external ID is not in the database
- **THEN** the system inserts a new game record

---

### Requirement: Admin can exclude games from the pick pool
The system SHALL allow an ADMIN to mark any synced game as excluded from the active pick pool. Excluded games are not presented to members for picking but remain in the database.

#### Scenario: Admin excludes a game
- **WHEN** an ADMIN toggles a game's pool status to excluded
- **THEN** the game no longer appears on the member pick entry screen for that week

#### Scenario: Admin re-includes a game
- **WHEN** an ADMIN re-includes a previously excluded game
- **THEN** the game reappears on the member pick entry screen, provided it has not yet kicked off

#### Scenario: Excluded game with existing picks
- **WHEN** an ADMIN excludes a game that members have already picked
- **THEN** the system SHALL warn the admin that existing picks will be orphaned and require confirmation before proceeding

---

### Requirement: Sync is admin-triggered in Day 1
In Day 1, the sync job SHALL be manually triggered by an ADMIN via a button in the admin panel. The schema SHALL include a `sync_mode` field (MANUAL | SCHEDULED) and a `scheduled_cron` field (nullable) to support automated scheduling in a future release without a migration.

#### Scenario: Admin triggers manual sync
- **WHEN** an ADMIN clicks "Sync Schedule" for a given week
- **THEN** the system runs the CFB and NFL pulls and reports a success or failure summary

#### Scenario: Sync fails due to API error
- **WHEN** the external API returns an error during sync
- **THEN** the system logs the error, does not partially commit the sync, and displays an error message to the admin

# Operations

## Purpose

Answering "is this healthy?" without reading the source, and getting the data back when something
goes wrong. These are the questions an operator asks at three in the morning, and the answers have
to be trustworthy enough to act on.

## Requirements

### Requirement: Job health distinguishes quiet from stuck

The system SHALL report, for every scheduled job, when it last succeeded, whether it has ever run,
whether its last run failed, its configured interval, and whether it has gone stale.

A job SHALL be stale when more time has passed than twice its own interval since its last
successful run, measured against the scheduler's start time when it has never succeeded.

Staleness SHALL be judged on elapsed time alone. Whether a run has been *attempted* SHALL NOT
enter the judgement: the scheduler marks a job as started before awaiting it, so "attempted, no
success yet" is the state of a healthy run in flight exactly as much as of a failed one.

#### Scenario: A first run still executing is not an outage
- **GIVEN** a job has started its first run and has not yet finished
- **WHEN** health is reported at exactly one interval after start-up
- **THEN** the job is not stale
- Verified by: `src/analytics/infrastructure/http/jobStaleness.test.ts`

#### Scenario: A fresh boot does not read as broken
- **WHEN** the scheduler has just started and no job has run
- **THEN** no job is stale
- Verified by: `src/analytics/infrastructure/http/jobStaleness.test.ts`

#### Scenario: Silence past the threshold is reported
- **WHEN** twice a job's interval passes with no successful run
- **THEN** the job is stale and the overall status degrades
- Verified by: `src/analytics/infrastructure/http/healthRoutes.test.ts`

### Requirement: The health endpoint stays safe to expose

The endpoint SHALL report job names, timings and database reachability, and SHALL NOT reveal the
port, host, data directory, or the names of measured sites. It is intended to be reachable without
authentication.

#### Scenario: No configuration leaks
- **WHEN** health is requested
- **THEN** the response contains no configured value
- Verified by: `src/analytics/infrastructure/http/healthRoutes.test.ts`

### Requirement: One command reports the whole picture

`tadoru status` SHALL report the version, data directory, whether a server answers and where, the
database size and event range, per-site counts and last events, the retention window against the
25-month limit, and job health.

It SHALL open the database strictly read-only — a diagnostic that can corrupt what it diagnoses is
worse than none, and it runs while the server is writing. It SHALL NOT read the admin password or
the session secret. It SHALL exit non-zero when a server does not answer or the database cannot be
read, so it works as a monitoring check rather than only as something to read.

#### Scenario: A foreign responder is not mistaken for Tadoru
- **GIVEN** an unrelated server answers JSON on a probed port
- **THEN** the command reports that nothing answered, and does not fail
- Verified by: `src/analytics/cli/status.test.ts`

#### Scenario: Job state is absent rather than invented
- **WHEN** no server answers
- **THEN** job state is reported as unavailable
- Verified by: `src/analytics/cli/status.test.ts`

### Requirement: Restoring a backup is one guarded command

`tadoru restore <backup-file>` SHALL replace the live database with `<backup-file>`, in this
order: refuse if a server answers on the resolved port, verify `<backup-file>` is actually a
Tadoru database, move the database currently in place to a dated file, then replace it — removing
any `-wal`/`-shm` sidecar files left next to it rather than leaving them behind.

It SHALL probe for a running server the same way `tadoru status` does. This SHALL be the one guard
`--force` can skip; every other guard SHALL still run under `--force`. The running-server check
SHALL come first, because it is the one failure mode that is not recoverable — a corrupted live
database from restoring underneath a running server cannot be undone the way a wrong backup file
choice can.

A file SHALL be trusted as a Tadoru database only once it opens as SQLite and carries the
`schema_migrations` and `events` tables. Restoring an unrelated `.db` file over a live installation
because the path was mistyped SHALL be impossible, not merely unlikely.

`--dry-run` SHALL run every guard for real and report the plan, and SHALL perform no filesystem
effect — no move, no copy, no delete. The command SHALL exit non-zero on every refusal.

#### Scenario: Refuses to restore while the server is running
- **GIVEN** a server answers on the resolved port
- **AND** `--force` is not passed
- **THEN** the command refuses, naming the command to stop the service, and exits non-zero
- Verified by: `src/analytics/cli/restore.test.ts`

#### Scenario: Refuses a backup file that does not exist
- **GIVEN** no server answers
- **AND** the given backup file does not exist
- **THEN** the command refuses and exits non-zero
- Verified by: `src/analytics/cli/restore.test.ts`

#### Scenario: Refuses a file that is not a valid SQLite database
- **GIVEN** the given path exists but does not open as SQLite
- **THEN** the command refuses and exits non-zero
- Verified by: `src/analytics/cli/restore.test.ts`

#### Scenario: Refuses a SQLite file that is not a Tadoru database
- **GIVEN** the given path opens as SQLite
- **AND** it is missing the `schema_migrations` or `events` table
- **THEN** the command refuses and exits non-zero
- Verified by: `src/analytics/cli/restore.test.ts`

#### Scenario: `--force` skips only the running-server check
- **GIVEN** a server answers on the resolved port
- **AND** `--force` is passed
- **AND** the given backup file does not exist, or is not a valid Tadoru database
- **THEN** the command still refuses for that reason
- Verified by: `src/analytics/cli/restore.test.ts`

#### Scenario: The current database is preserved before being replaced
- **GIVEN** a valid backup file and no running server
- **THEN** the database in place beforehand is moved to a dated file before the backup replaces it
- Verified by: `src/analytics/cli/restore.test.ts`

#### Scenario: Stale WAL and SHM files do not survive a restore
- **GIVEN** `-wal` and/or `-shm` files exist next to the live database
- **WHEN** the restore replaces it
- **THEN** those sidecar files are removed
- Verified by: `src/analytics/cli/restore.test.ts`

#### Scenario: A dry run touches nothing
- **GIVEN** `--dry-run` is passed
- **THEN** every guard still runs, the plan is printed, and no file is moved, copied, or deleted
- Verified by: `src/analytics/cli/restore.test.ts`

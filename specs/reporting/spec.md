# Reporting

## Purpose

Turn stored events into the numbers an operator reads. The whole difficulty is that unique
visitors do not add up, and a naive schema produces confidently wrong figures. See
`docs/adr/0002-sqlite-with-per-dimension-rollups.md`.

## Requirements

### Requirement: Unique visitors are counted independently per dimension

The system SHALL compute each dimension's visitor count as its own exact
`COUNT(DISTINCT visitor_id)` over raw events, and SHALL NOT derive one dimension's counts by
summing or joining another dimension's rollup.

#### Scenario: One visitor, two paths, one country
- **GIVEN** a single visitor views two different paths from one country on one day
- **WHEN** the daily rollups are built
- **THEN** the visitor total across the path rollup is 2, counted once per path
- **AND** the visitor total across the country rollup is 1
- Verified by: `src/analytics/infrastructure/persistence/sqlite/SqliteRollupBuilder.test.ts`

#### Scenario: Pageviews stay additive
- **GIVEN** a visitor views the same path twice
- **THEN** that path's rollup row records 2 pageviews and 1 visitor
- Verified by: `src/analytics/infrastructure/persistence/sqlite/SqliteRollupBuilder.test.ts`

### Requirement: Rebuilding a day is idempotent

The system SHALL replace a day's rollup rows when recomputing it, and SHALL NOT duplicate or
accumulate them.

#### Scenario: Running twice changes nothing
- **WHEN** the rollups for one day are built twice
- **THEN** the resulting rows are identical to building them once
- Verified by: `src/analytics/infrastructure/persistence/sqlite/SqliteRollupBuilder.test.ts`

### Requirement: Closed days read from rollups, today reads from raw

The system SHALL serve completed days from rollup tables and the current day from raw events,
and SHALL combine them without double counting.

### Requirement: Report queries are injection-proof

The system SHALL bind every value as a parameter and SHALL select the breakdown table from a
fixed internal allow-list.

#### Scenario: An arbitrary dimension name is rejected
- **WHEN** a breakdown name outside the allow-list is requested
- **THEN** the request is rejected and no SQL is executed with that string
- Verified by: `src/analytics/infrastructure/persistence/sqlite/SqliteMetricsRepository.test.ts`

### Requirement: Sessions and bounces are derived, not stored per visitor

A session is one visitor's activity with no gap longer than the configured inactivity window. A
bounce is a session with a single pageview and engagement below the threshold.

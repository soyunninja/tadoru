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

### Requirement: Screen size, language and colour scheme are reportable breakdown dimensions

The system SHALL expose `screen`, `language` and `colorScheme` as breakdown dimensions, each with
its own daily rollup table (`rollup_daily_screen`, `rollup_daily_language`,
`rollup_daily_color_scheme`), reading the raw signal already collected in `events`
(`screen_bucket`, `lang`, `color_scheme` respectively) the same way every other dimension does.

#### Scenario: A pixel hit with no client signals aggregates under one empty key
- **GIVEN** a pixel (noscript) hit carries none of `screen_bucket`, `lang` or `color_scheme`
- **WHEN** the daily rollups are built
- **THEN** that hit's visitor is counted once under the empty key in each of the three rollup
  tables, rather than being dropped or given its own row per hit
- Verified by: `src/analytics/infrastructure/persistence/sqlite/SqliteRollupBuilder.test.ts`

#### Scenario: The three dimensions resolve through the same fixed allow-list as every other dimension
- **WHEN** `screen`, `language` or `colorScheme` is requested as a breakdown
- **THEN** it resolves to its allow-listed rollup table and raw column, exactly like the seven
  existing dimensions
- Verified by: `src/analytics/domain/report/Breakdown.test.ts`

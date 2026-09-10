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

### Requirement: Scroll depth is reported per page, as an average of per-session maxima

The system SHALL report, for each page, how far down that page people get.

The tracker emits every milestone newly crossed, so a session that reaches 75% leaves three raw
events — 25, 50 and 75. Averaging the raw `value` column would therefore report 50% for a session
that read three quarters of the page. The reported depth SHALL be the average of the **maximum**
value per `(path, session_id)` pair, never the average of the raw values.

Closed days SHALL be read from the `rollup_daily_scroll` aggregate and the current day from raw
events, the same split every other report uses, so today is live rather than waiting for the
nightly build. The rollup SHALL store the sum of per-session maxima and the count of contributing
sessions, so that an average over a multi-day range remains correct as `SUM(depth_sum) /
SUM(session_count)`.

Each row SHALL also report its coverage: how many of that path's sessions produced scroll data at
all, against the path's total sessions in the range. Both sides SHALL be counted in sessions.
Page views cannot serve as the numerator — a scroll event carries no page-view identity, so two
views of one page within a session are indistinguishable — and using page views on one side only
would divide one unit by another. Scroll rows describe a self-selected
subset — a page shorter than the viewport emits no milestone at all, and neither does a visitor
who lands and leaves — so an average over only those who scrolled overstates engagement. Reporting
the average alone, without saying how few or how many it is drawn from, would present that bias as
a fact.

A range containing no scroll data at all SHALL say so with a scroll-specific message, rather than
rendering an empty table or a depth of 0%. It SHALL NOT reuse the breakdowns' generic "no data for
this range": a range can hold plenty of data and still no scroll data, because a page shorter than
the viewport emits no milestone, and the generic wording would report an absence that is not
there.

Scroll depth is NOT a breakdown dimension: it is not a value-to-visitors table, and it SHALL NOT
appear in `BREAKDOWN_DIMENSIONS`. Its rollup table SHALL be listed among the aggregate tables,
which SHALL stay disjoint from the dimension tables, so that the exact-equality check between the
dimension tables and the breakdown allow-list keeps its meaning.

Known and accepted: `session_count` is summed across days, so a session with scroll events on both
sides of UTC midnight contributes to each day. This mirrors the salt rotation, which already splits
such a session in two, and is preferred to storing session identity across days.

#### Scenario: A session reaching 75% is reported as 75, not 50
- **GIVEN** one session emits scroll milestones of 25, 50 and 75 for the same path
- **THEN** the reported depth for that path is 75%
- Verified by: `src/analytics/domain/report/ScrollDepth.test.ts`,
  `src/analytics/infrastructure/persistence/sqlite/SqliteScrollDepthRepository.test.ts`,
  `src/analytics/infrastructure/http/dashboardRoutes.test.ts`

#### Scenario: Coverage is reported beside the average
- **GIVEN** a path with two sessions, only one of which produced scroll data
- **THEN** the row reports the average depth and that it is drawn from 1 of 2 sessions
- Verified by: `src/analytics/infrastructure/http/dashboardRoutes.test.ts`

#### Scenario: Today is read from raw events, closed days from the rollup
- **WHEN** the requested range includes the current day
- **THEN** that day's depth comes from raw events rather than from the nightly aggregate
- Verified by: `src/analytics/application/QuerySiteScrollDepth.test.ts`

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

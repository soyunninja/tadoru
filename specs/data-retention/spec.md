# Data retention

## Purpose

Bounded retention is one of the conditions of the audience-measurement exemption. Exceeding it
does not merely create risk; it removes the legal basis for operating without a consent banner.

## Requirements

### Requirement: Raw events expire

The system SHALL delete raw event rows older than the configured retention window, SHALL default
that window to 25 months, and SHALL run the deletion without operator intervention.

#### Scenario: The boundary is respected
- **GIVEN** the retention window is 25 months
- **WHEN** the purge runs
- **THEN** a row exactly at the boundary is kept and a row past it is deleted
- Verified by: `src/analytics/application/PurgeExpiredData.test.ts`

### Requirement: Aggregates are not purged

The system SHALL retain rollup tables indefinitely, since they hold no identifiers.

### Requirement: An unlawful retention setting is announced, not silently accepted

The system SHALL warn on startup when the configured retention exceeds 25 months, stating that
the consent exemption no longer applies.

#### Scenario: An over-long window warns
- **WHEN** retention is configured above 25 months
- **THEN** startup emits a warning naming the consequence
- Verified by: the configuration tests

### Requirement: Only the current salt exists

The system SHALL store exactly one salt and SHALL overwrite it on rotation, leaving the previous
value unrecoverable.

#### Scenario: Rotation erases the predecessor
- **WHEN** the salt rotates
- **THEN** the previous value is present nowhere in the database
- Verified by: `src/analytics/infrastructure/salt/SqliteSaltProvider.test.ts`

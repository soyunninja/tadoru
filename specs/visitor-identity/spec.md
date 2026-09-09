# Visitor identity

## Purpose

Count unique visitors and reconstruct sessions without cookies and without any identifier that
outlives a single day or spans more than one site. This capability is the reason the product
needs no consent banner; see `docs/adr/0001-daily-rotating-salt-for-visitor-identity.md`.

## Requirements

### Requirement: Visitor identity is derived, never stored raw

The system SHALL derive a visitor identifier as a `blake2b` hash over the current salt, the site
identifier, the visitor's IP address and the visitor's user-agent, truncated to 16 bytes.

The system SHALL NOT persist the IP address or the user-agent in any form.

#### Scenario: Identical requests yield the same identifier
- **WHEN** two requests share the same salt, site, IP and user-agent
- **THEN** the derived visitor identifier is identical
- Verified by: `src/analytics/domain/event/VisitorId.test.ts`

#### Scenario: Field boundaries cannot be confused
- **WHEN** the concatenated inputs would be ambiguous, such as salt `ab` with site `c` versus
  salt `a` with site `bc`
- **THEN** the derived identifiers differ
- Verified by: `src/analytics/domain/event/VisitorId.test.ts`

### Requirement: Identity does not survive the day

The system SHALL replace the salt every 24 hours, SHALL store only the current salt, and SHALL
make the previous salt unrecoverable after rotation.

#### Scenario: Rotation breaks the link
- **WHEN** the salt is rotated
- **AND** an otherwise identical request arrives
- **THEN** the derived visitor identifier differs from the one derived before rotation
- Verified by: `src/analytics/domain/event/VisitorId.test.ts`

#### Scenario: The old salt leaves no trace
- **WHEN** the salt is rotated
- **THEN** the previous salt value appears nowhere in the database
- Verified by: the salt provider tests

### Requirement: Identity does not span sites

The system SHALL include the site identifier among the hash inputs.

#### Scenario: The same person on two sites is two visitors
- **WHEN** the same IP and user-agent visit two different measured sites on the same day
- **THEN** the two derived identifiers are unrelated
- Verified by: `src/analytics/domain/event/VisitorId.test.ts`

### Requirement: Sessions close after inactivity

The system SHALL treat two events from one visitor as the same session when the gap between
them is 30 minutes or less, and SHALL start a new session otherwise.

#### Scenario: The boundary is inclusive
- **WHEN** the gap is exactly 30 minutes
- **THEN** the session continues
- **WHEN** the gap is 30 minutes and one millisecond
- **THEN** a new session begins
- Verified by: `src/analytics/domain/event/SessionId.test.ts`

## Accepted limitations

These follow from the requirements above and are deliberate, not defects.

- A session spanning midnight UTC is recorded as two sessions, because the salt rotates.
- Returning visitors, retention curves and cohort analysis are impossible and out of scope.
- The IP address is processed transiently in memory to derive the hash and resolve a country.
  The privacy notice states this rather than claiming the address is never seen.

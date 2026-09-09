# Installation

## Purpose

This software runs on other people's servers. Anything an operator must remember to configure
correctly will eventually be configured incorrectly, so safety belongs in defaults and in
refusals, not in documentation. See `docs/adr/0003-native-install-over-containers.md`.

## Requirements

### Requirement: The service refuses to start without an admin password

The system SHALL refuse to start when the admin password is unset, empty, or equal to a known
example value, and SHALL explain how to generate one. It SHALL NOT ship or generate a default
credential silently.

#### Scenario: A placeholder password is rejected
- **WHEN** the admin password is `change-me`
- **THEN** startup fails with a message naming the problem and the fix
- Verified by: the configuration tests

### Requirement: Forwarded headers are trusted only when declared

The system SHALL read the client address from `X-Forwarded-For` only when a reverse proxy has
been declared, and SHALL otherwise use the socket address.

#### Scenario: Header spoofing is ignored without a proxy
- **GIVEN** no reverse proxy is declared
- **WHEN** a request carries a forged `X-Forwarded-For`
- **THEN** the socket address is used and the forged value is ignored
- Verified by: `src/analytics/infrastructure/http/requestContext.test.ts`

### Requirement: Migrations apply themselves

The system SHALL apply schema migrations on startup, idempotently and inside a transaction. An
operator SHALL never run a migration command manually.

### Requirement: Scheduled work needs no crontab

The system SHALL run salt rotation, nightly rollups and retention purging in-process, and SHALL
stop them cleanly on `SIGTERM` so an in-flight batch is flushed rather than lost.

### Requirement: Backup is one command over one file

The system SHALL produce a consistent backup with a single command, and restoring SHALL be
copying that file back.

### Requirement: The published package runs on every supported Node

The published package SHALL run on any Node release still receiving security updates, currently
Node 22 and later, while development MAY require a newer runtime.

The floor SHALL NOT be lowered to a Node release past its maintenance window, and SHALL NOT be
declared looser than what the dependency tree actually supports — `engines` is advisory, so an
optimistic floor does not fail at install time. It crashes later.

#### Scenario: Compiled output needs no type stripping
- **WHEN** the package is built for publication
- **THEN** the emitted JavaScript imports `.js` paths and runs without type stripping
- Verified by: `npm run build` followed by running the output

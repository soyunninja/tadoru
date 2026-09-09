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

### Requirement: An explicitly configured port is pinned; an unconfigured one is chosen automatically

An explicitly configured port (via `TADORU_PORT` or `"port"` in `tadoru.config.json`) SHALL never
silently move. On a server a reverse proxy, or the systemd unit's own `TADORU_PORT`, points at a
fixed port; if Tadoru bound a different one instead of refusing, the proxy would keep pointing at
the old one and analytics would stop with no error anywhere. That failure is worse than refusing
to start, so a busy explicit port SHALL fail startup with a message naming the port and offering
to free it or choose another, and SHALL NOT try a different port.

When no port is configured at all, the system SHALL try binding 3000, then 3001, 3002, and so on
up to 3009, in that fixed order, and SHALL bind the first one that is free. This exists so a
first-time, local run is not blocked by an unrelated development server already holding 3000. If
every candidate in that range is busy, startup SHALL fail with a message saying so.

Because only an actual bind attempt reveals whether a port is busy, the system SHALL learn this
from the bind itself (catching `EADDRINUSE`) rather than probing the port separately first — a
separate probe-then-bind sequence would leave a window in which something else could take the
port in between. Any bind failure that is not `EADDRINUSE` (a bad address, a permissions error,
...) SHALL propagate unchanged rather than being treated as "busy" and triggering a fallback.

The startup message SHALL always report the port actually bound, never merely the one requested,
and SHALL say when it was chosen automatically rather than being the first candidate, so an
operator is never left wondering why the service is not on 3000.

#### Scenario: An explicit busy port fails instead of moving
- **GIVEN** `TADORU_PORT` (or `"port"` in `tadoru.config.json`) is set
- **WHEN** that port is already in use
- **THEN** startup fails with a message naming the port, and no other port is tried
- Verified by: `src/analytics/infrastructure/http/bindPort.test.ts`,
  `src/analytics/composition.test.ts`

#### Scenario: An explicit free port binds directly
- **GIVEN** `TADORU_PORT` (or `"port"` in `tadoru.config.json`) is set
- **WHEN** that port is free
- **THEN** the service binds it
- Verified by: `src/analytics/infrastructure/http/bindPort.test.ts`

#### Scenario: An unset port binds 3000 when it is free
- **GIVEN** neither `TADORU_PORT` nor `"port"` in `tadoru.config.json` is set
- **WHEN** port 3000 is free
- **THEN** the service binds 3000, and the startup message does not call out an automatic choice
- Verified by: `src/analytics/infrastructure/http/bindPort.test.ts`,
  `src/analytics/composition.test.ts`

#### Scenario: An unset port walks to the next free candidate
- **GIVEN** neither `TADORU_PORT` nor `"port"` in `tadoru.config.json` is set
- **WHEN** port 3000 is busy but 3001 is free
- **THEN** the service binds 3001, and the startup message names 3001 and notes that 3000 was busy
- Verified by: `src/analytics/infrastructure/http/bindPort.test.ts`,
  `src/analytics/composition.test.ts`

#### Scenario: All ten candidates busy fails with a useful message
- **GIVEN** neither `TADORU_PORT` nor `"port"` in `tadoru.config.json` is set
- **WHEN** ports 3000 through 3009 are all busy
- **THEN** startup fails with a message naming the whole range
- Verified by: `src/analytics/infrastructure/http/bindPort.test.ts`,
  `src/analytics/composition.test.ts`

#### Scenario: A non-`EADDRINUSE` bind failure is never treated as "busy"
- **WHEN** a bind attempt fails with any error other than `EADDRINUSE`
- **THEN** that error propagates unchanged, and no other port is tried
- Verified by: `src/analytics/infrastructure/http/bindPort.test.ts`

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

### Requirement: `install-service` performs the installation it claims to perform

`sudo tadoru install-service --sites <domains>` SHALL leave a fresh Linux host ready to run
Tadoru under systemd, requiring no manual step besides `sudo systemctl enable --now tadoru`
afterwards. It SHALL NOT start or enable the service itself — preparing the machine and starting
it are different decisions, and the second stays the operator's.

In order, it SHALL: refuse unless run as root; refuse on any platform other than Linux; require
at least one site that validates through the site-id rules, refusing otherwise; create the
`tadoru` system user and group if missing, with no home directory and no login shell; create
`/etc/tadoru/`; write `/etc/tadoru/tadoru.env` (mode 0600, root-owned) with a freshly generated
admin password, the configured sites, `TADORU_HOST=127.0.0.1`, `TADORU_PORT=3000`,
`TADORU_TRUSTED_PROXY=true` and a language — unless that file already exists, in which case it
SHALL be left untouched; write the systemd unit; and run `systemctl daemon-reload`. The generated
admin password SHALL be printed to stdout exactly once, with a warning that it will not be shown
again, and SHALL never be passed as a command-line argument to any process it invokes.

A `--dry-run` invocation SHALL print every one of the above actions, in order, and SHALL perform
none of them.

#### Scenario: Refuses without root
- **WHEN** `install-service` is run by a non-root user on Linux
- **THEN** it refuses with a message naming `sudo`, and performs no action
- Verified by: `src/analytics/cli/installService.test.ts`

#### Scenario: Refuses on a non-Linux platform
- **WHEN** `install-service` is run on a platform other than Linux
- **THEN** it refuses with a message naming Linux and systemd, even under `--dry-run`
- Verified by: `src/analytics/cli/installService.test.ts`

#### Scenario: Refuses without at least one valid site
- **WHEN** `--sites` is omitted, empty, or every candidate fails site-id validation
- **THEN** it refuses with a message naming `--sites`, and performs no action
- Verified by: `src/analytics/cli/installService.test.ts`

#### Scenario: An existing admin password is never regenerated
- **GIVEN** `/etc/tadoru/tadoru.env` already exists
- **WHEN** `install-service` runs again
- **THEN** the existing file is kept unchanged, no new password is generated, and every other
  step still runs
- Verified by: `src/analytics/cli/installService.test.ts`

#### Scenario: The admin-password file is never briefly world-readable
- **WHEN** `install-service` creates `/etc/tadoru/tadoru.env`
- **THEN** the file is created at mode 0600 from the first write, not chmod'd afterwards
- Verified by: `src/analytics/cli/installService.test.ts`

#### Scenario: `--dry-run` performs no effect
- **WHEN** `install-service --dry-run` runs on Linux as root
- **THEN** it prints the ordered plan and the rendered unit, and calls none of the user, directory,
  file, or systemd ports
- Verified by: `src/analytics/cli/installService.test.ts`

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

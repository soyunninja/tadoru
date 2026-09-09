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

### Requirement: The admin credential may be configured pre-hashed or as plaintext

The system SHALL accept the admin credential in either of two forms: a pre-hashed
`TADORU_ADMIN_PASSWORD_HASH` / `TADORU_ADMIN_PASSWORD_SALT` pair, or a plaintext
`TADORU_ADMIN_PASSWORD` (or `"adminPassword"` in `tadoru.config.json`), which SHALL be hashed at
load time exactly as before. Plaintext support SHALL NOT be removed: an operator hand-editing the
env file may still reasonably set it directly.

When both forms are present, the pre-hashed pair SHALL win. This is what `install-service` and
`reset-password` now write, so it is the common case; preferring it also means a leftover
plaintext value (from hand-editing, or from before this file was rehashed) can never silently
override a freshly rotated hash+salt pair sitting next to it.

If `TADORU_ADMIN_PASSWORD_HASH` is set without `TADORU_ADMIN_PASSWORD_SALT`, or the reverse, the
system SHALL refuse to start with a message naming exactly the missing one — never a generic
"invalid config" message.

A pre-hashed pair SHALL be accepted only when each value is hexadecimal of exactly the length
`hashPassword` produces; otherwise the system SHALL refuse to start, naming the offending
variable and how to generate a real pair. A value that cannot have come from `hashPassword` — the
placeholder shipped in `deploy/tadoru.env.example`, a truncated copy-paste, a value from another
tool — can never match any password, so accepting it would start a server that rejects every
login with nothing in the logs to explain why. `deploy/tadoru.env.example` tells the operator to
copy it to `/etc/tadoru/tadoru.env`, so following that instruction SHALL produce a refusal at
boot, not a silent lockout.

#### Scenario: A pre-hashed pair is accepted directly
- **GIVEN** `TADORU_ADMIN_PASSWORD_HASH` and `TADORU_ADMIN_PASSWORD_SALT` are both set
- **THEN** the service loads using that pair unchanged
- Verified by: `src/analytics/infrastructure/config/loadConfig.test.ts`

#### Scenario: The pre-hashed pair wins over plaintext when both are present
- **GIVEN** `TADORU_ADMIN_PASSWORD_HASH`/`TADORU_ADMIN_PASSWORD_SALT` and `TADORU_ADMIN_PASSWORD`
  are all set
- **THEN** the resolved credential matches the hash+salt pair, and the plaintext value is ignored
- Verified by: `src/analytics/infrastructure/config/loadConfig.test.ts`

#### Scenario: A hash without its salt is refused by name
- **GIVEN** `TADORU_ADMIN_PASSWORD_HASH` is set and `TADORU_ADMIN_PASSWORD_SALT` is not
- **THEN** startup fails with a message naming `TADORU_ADMIN_PASSWORD_SALT` as missing
- Verified by: `src/analytics/infrastructure/config/loadConfig.test.ts`

#### Scenario: A salt without its hash is refused by name
- **GIVEN** `TADORU_ADMIN_PASSWORD_SALT` is set and `TADORU_ADMIN_PASSWORD_HASH` is not
- **THEN** startup fails with a message naming `TADORU_ADMIN_PASSWORD_HASH` as missing
- Verified by: `src/analytics/infrastructure/config/loadConfig.test.ts`

#### Scenario: The placeholder pair shipped in the example env file is refused
- **GIVEN** the `TADORU_ADMIN_PASSWORD_HASH`/`TADORU_ADMIN_PASSWORD_SALT` values read from
  `deploy/tadoru.env.example`
- **THEN** startup fails with a message naming the variable and pointing at
  `tadoru reset-password`
- Verified by: `src/analytics/infrastructure/config/loadConfig.test.ts`, which reads the shipped
  file rather than restating its values, so the refusal holds whatever the placeholder becomes

#### Scenario: A malformed hash or salt is refused
- **GIVEN** `TADORU_ADMIN_PASSWORD_HASH` or `TADORU_ADMIN_PASSWORD_SALT` is set to a value that is
  not hexadecimal of the expected length
- **THEN** startup fails with a message naming that variable and pointing at
  `tadoru reset-password`
- Verified by: `src/analytics/infrastructure/config/loadConfig.test.ts`

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

### Requirement: `/health` reports job health honestly, not just "ran at least once, eventually"

The system SHALL distinguish, for each scheduled job, three facts: whether it has ever been
attempted, the timestamp of its last *successful* completion, and whether its most recent attempt
threw. A job's last successful timestamp SHALL NOT be overwritten by a later failing attempt — the
last time it actually worked SHALL remain visible even while it is currently failing.

The system SHALL judge a job stale when it has gone meaningfully longer than its own configured
interval without a successful run, using a fixed multiplier of its interval so that ordinary
jitter (a slow batch, a GC pause, a timer firing a little late under load) is not reported as an
outage. A job that has never run at all SHALL be judged against how long the scheduler has
actually been running, not against epoch zero, so a fresh boot SHALL NOT report every job as
instantly stale.

`GET /health` SHALL report `status: "error"` (HTTP 503) whenever the database is unreachable,
regardless of job state. Otherwise it SHALL report `status: "degraded"` (HTTP 200) when at least
one job is stale, and `status: "ok"` (HTTP 200) otherwise. The response SHALL continue to omit
port, host, data directory, and configured site names.

#### Scenario: A job's last successful run survives a later failure
- **GIVEN** a job has succeeded before
- **WHEN** its next attempt throws
- **THEN** `/health` still reports the earlier successful timestamp, and separately reports the
  job as currently failed
- Verified by: `src/analytics/infrastructure/scheduler/Scheduler.test.ts`

#### Scenario: A job that has never run is judged against scheduler uptime, not epoch zero
- **GIVEN** the scheduler started recently and a job has never run
- **WHEN** less time has passed than its staleness threshold
- **THEN** the job is reported as not stale
- Verified by: `src/analytics/infrastructure/http/jobStaleness.test.ts`

#### Scenario: A job well past its interval with no success is reported stale
- **GIVEN** a job's last success (or, if it has never run, the scheduler's start time) is older
  than the staleness threshold
- **WHEN** `/health` is requested
- **THEN** that job is reported `stale: true` and the overall status is `degraded`
- Verified by: `src/analytics/infrastructure/http/jobStaleness.test.ts`,
  `src/analytics/infrastructure/http/healthRoutes.test.ts`

#### Scenario: Database unreachability always wins the top-level status
- **GIVEN** the database is unreachable and a job is also stale
- **WHEN** `/health` is requested
- **THEN** the response is `status: "error"` with HTTP 503, not `"degraded"`
- Verified by: `src/analytics/infrastructure/http/healthRoutes.test.ts`

### Requirement: `tadoru status` answers "is Tadoru working?" in one command

The system SHALL provide a `tadoru status` command that reports, without requiring any other
tool: the installed version and data directory; whether a server is answering `/health` and on
which port, resolved by probing candidates in the same order `bindPort.ts` binds them, never by
guessing or hardcoding a port; whether the database opens read-only and, if so, its size, total
event count, oldest/newest event, and each configured site's event count and last event; the
configured retention period, with an explicit callout when it exceeds the consent-exemption
threshold; and, only when a server answered, each scheduled job's health as reported by that
server's `/health` — job state SHALL NOT be fabricated when no server answered.

It SHALL open the database strictly read-only, so it can never interfere with the live server or
corrupt anything. It SHALL exit `0` only when a server answered *and* the database opened
successfully, so it can be used as a monitoring check; a stale job or retention past the exemption
window is reported, not treated as a command failure on its own. It SHALL NOT read or print
`config.admin` or `config.session` fields, so it can never leak the admin password hash or the
session secret. A `--json` flag SHALL emit the same information as machine-readable JSON.

#### Scenario: A server is answering and the database is readable
- **WHEN** a server answers `/health` on one of the candidate ports and the database opens
- **THEN** `tadoru status` exits `0` and reports the answering port, database contents, and each
  scheduled job's health from that server's `/health` response
- Verified by: `src/analytics/cli/status.test.ts`

#### Scenario: No server is answering
- **WHEN** no candidate port answers `/health`
- **THEN** `tadoru status` exits non-zero, states plainly that no server is answering, still
  reports the database section from its own read-only inspection, and reports job state as
  unavailable rather than guessing it
- Verified by: `src/analytics/cli/status.test.ts`

#### Scenario: The database cannot be read
- **WHEN** the database file is missing or is not a valid SQLite database
- **THEN** `tadoru status` exits non-zero, reports a clear reason, and does not crash
- Verified by: `src/analytics/cli/status.test.ts`

### Requirement: `install-service` performs the installation it claims to perform

`sudo tadoru install-service --sites <domains>` SHALL leave a fresh Linux host ready to run
Tadoru under systemd, requiring no manual step besides `sudo systemctl enable --now tadoru`
afterwards. It SHALL NOT start or enable the service itself — preparing the machine and starting
it are different decisions, and the second stays the operator's.

In order, it SHALL: refuse unless run as root; refuse on any platform other than Linux; require
at least one site that validates through the site-id rules, refusing otherwise; create the
`tadoru` system user and group if missing, with no home directory and no login shell; create
`/etc/tadoru/`; write `/etc/tadoru/tadoru.env` (mode 0600, root-owned) with the scrypt hash and
salt of a freshly generated admin password (`TADORU_ADMIN_PASSWORD_HASH` /
`TADORU_ADMIN_PASSWORD_SALT` — never the plaintext value), the configured sites,
`TADORU_HOST=127.0.0.1`, `TADORU_PORT=3000`, `TADORU_TRUSTED_PROXY=true` and a language — unless
that file already exists, in which case it SHALL be left untouched; write the systemd unit; and
run `systemctl daemon-reload`. The generated admin password SHALL be printed to stdout exactly
once, with a warning that it will not be shown again, and SHALL never be passed as a command-line
argument to any process it invokes, and SHALL NOT be written to disk in plaintext anywhere.

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

#### Scenario: The written env file never contains the plaintext password
- **WHEN** `install-service` writes `/etc/tadoru/tadoru.env`
- **THEN** the file contains `TADORU_ADMIN_PASSWORD_HASH` and `TADORU_ADMIN_PASSWORD_SALT`, and no
  `TADORU_ADMIN_PASSWORD` line anywhere
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

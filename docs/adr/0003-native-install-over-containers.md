# 0003 — Native install as the primary distribution

Status: accepted, supersedes the container-first approach in the original plan

## Context

The first design made Docker Compose the primary installation path, on the argument that
SQLite removes the database container and leaves a single service. The maintainer preferred a
native install.

A single Node process plus a single SQLite file genuinely does not need a container.

## Decision

`npm install -g tadoru`, `tadoru init`, `sudo tadoru install-service`, with a hardened systemd
unit. Docker files remain in `docker/` as a secondary option for people who already run that
infrastructure.

## Consequences

- **Container isolation is lost and must be replaced.** The systemd unit does that work:
  dedicated unprivileged user, empty `CapabilityBoundingSet`, `ProtectSystem=strict`,
  `PrivateDevices`, `RestrictAddressFamilies` limited to IP and AF_UNIX,
  `SystemCallFilter=@system-service`, and `StateDirectory` at mode 0700. Verify with
  `systemd-analyze security tadoru`.
- **`MemoryDenyWriteExecute` must stay off.** V8's JIT needs writable executable pages and Node
  will not start with it enabled. Generic hardening templates enable it, so the unit carries a
  comment saying why it is absent.
- The admin password lives in `/etc/tadoru/tadoru.env` at mode 0600, referenced through
  `EnvironmentFile`, never in argv where it would be visible in the process list.
- The Node version on the target machine is no longer controlled by an image, which forces the
  dual-distribution approach in ADR 0004.

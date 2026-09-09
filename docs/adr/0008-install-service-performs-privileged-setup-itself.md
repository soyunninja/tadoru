# 0008 — `install-service` performs privileged setup itself, rather than printing it

Status: accepted

## Context

`sudo tadoru install-service` rendered a systemd unit and told the operator what else to do:
create the `tadoru` system user, create `/etc/tadoru/`, write `/etc/tadoru/tadoru.env` with a
generated admin password at mode 0600, and run `systemctl daemon-reload`. The README claimed the
command "creates the user and the systemd unit" — it did not. Everything except the unit file was
left as five undocumented manual steps, each one a place a fresh install could go wrong: an
operator who forgets `daemon-reload` gets a confusing "unit not found"; one who forgets the 0600
mode leaves the admin password world-readable; one who skips the dedicated user runs the process
as root.

Two ways to close that gap were on the table:

1. Keep the command read-only, and have it print the exact shell commands (`useradd ...`,
   `install -m 0600 ...`, `systemctl daemon-reload`) for the operator to paste.
2. Have the command run those operations itself.

Option 1 keeps the CLI's blast radius small and every action visible before it happens. It also
keeps the eight-step setup exactly as error-prone as before: printing the right command is not
different from documenting it, and ADR 0003's premise — "anything an operator must remember to
configure correctly will eventually be configured incorrectly" — applies just as much to a
copy-pasted command block as to a paragraph in the README.

## Decision

`install-service` performs the setup itself: creates the `tadoru` system user and group if
missing, creates `/etc/tadoru/`, generates and writes the admin password to
`/etc/tadoru/tadoru.env` at mode 0600 (only if that file does not already exist — a re-run must
never regenerate, and so never change, an operator's password), writes the systemd unit, and runs
`systemctl daemon-reload`. It refuses outright unless run as root, since every one of those is a
privileged operation, and it deliberately stops short of starting or enabling the service —
preparing the machine and starting it stay two separate decisions.

Every effect goes through an injected port (create user, path-exists check, write file, run
`systemctl`), the same pattern `renderUnitFile`'s `writeUnitFile` already used, so the test suite
exercises the real decision logic without creating a system user or touching `/etc` on the
machine running the tests.

## Consequences

- Fresh-VPS setup is `sudo npm install -g tadoru`, `sudo tadoru install-service --sites ...`,
  `sudo systemctl enable --now tadoru` — three commands instead of eight manual steps, matching
  what the README already claimed.
- The CLI now runs privileged operations (`useradd`, writing root-owned files, `systemctl`)
  instead of only ever rendering text. That is a larger blast radius than before, and it is
  accepted deliberately: the alternative (printing commands) does not actually remove the manual
  steps ADR 0003 argues against, only relocates them into a paste target.
- `--dry-run` stays the fully tested path: it prints the ordered plan and calls no port at all,
  so anyone can preview exactly what a real run would do before granting it root.
- A re-run is safe by construction: the user-and-directory steps are idempotent, and
  `tadoru.env` is never overwritten once it exists, so running `install-service` again (say, after
  an upgrade, to refresh the unit) cannot silently rotate the admin password out from under a
  logged-in operator.

# 0010 — The admin credential is stored hashed, and `reset-password` replaces it

Status: accepted

## Context

`install-service` generated a strong admin password and wrote it into `/etc/tadoru/tadoru.env` as
`TADORU_ADMIN_PASSWORD=<plaintext>`. `loadConfig.ts` hashed it into memory on every start with
scrypt, and `adminAuth.ts` only ever compared against that in-memory hash — but the working
plaintext credential still sat on disk, at mode 0600, for as long as the installation existed. The
README even claimed the opposite: "There is no recovery, by design: it is stored hashed." That was
false. Anyone who could read `/etc/tadoru/tadoru.env` — a root shell, a misconfigured backup that
swept up `/etc`, a config-management tool that logged file contents — had the real password, not a
hash of it.

There was also no supported way to change a lost or compromised password short of hand-editing
that file, which meant the "recovery" story described in the README (edit the file, restart) was
itself a plaintext round-trip: type the new password in cleartext, into a root-owned file, by hand.

## Decision

`install-service` now writes the scrypt hash and salt of the generated password —
`TADORU_ADMIN_PASSWORD_HASH` and `TADORU_ADMIN_PASSWORD_SALT` — instead of the plaintext value,
reusing `hashPassword` from `adminAuth.ts` rather than a second implementation. `loadConfig.ts`
accepts either that pre-hashed pair or a plaintext `TADORU_ADMIN_PASSWORD` (still hashed at load
time exactly as before), with the pre-hashed pair winning when both are present — see the comment
at that branch in `loadConfig.ts` for why. Plaintext support is kept, not removed: an operator
hand-editing the file by hand still has a reasonable way to set a new password without a hashing
tool at their fingertips.

Because a hash cannot be turned back into the password it came from, losing the password now
means resetting it rather than reading it back — so a new command, `tadoru reset-password`, does
that: it generates a fresh password with `crypto.randomBytes`, hashes it, and rewrites only the
credential lines of the existing `tadoru.env`, leaving every other line (comments, sites, host,
port, anything an operator added by hand) untouched. It never accepts the new password as a
command-line argument — generating it internally is the only way to guarantee it never lands in a
shell history or a process list — and it backs the file up to a dated copy before touching it, the
same way `restore` backs up the database it is about to replace.

## Consequences

- No copy of a live, working admin credential sits anywhere on disk — not in `tadoru.env`, and not
  in any backup taken of it — once `install-service` or `reset-password` has printed it to stdout
  once. Reading that file (or a backup of it) no longer hands out the real password.
- There are now two supported ways to configure the same credential (hash+salt, or plaintext),
  each read by `loadConfig.ts` with an explicit precedence rule, instead of one. That is a larger
  surface than before, accepted because removing plaintext support would leave a hand-editing
  operator with a config-file field they cannot fill in without external tooling.
- A lost admin password is now genuinely unrecoverable rather than merely inconvenient: there is
  no path from the stored hash back to the password, by construction. `reset-password` is the
  supported way forward, and the README's incorrect recovery claim has been corrected to describe
  it.
- `reset-password` follows the same port-injection pattern as `install-service` and `restore`:
  every effect (root check, path existence, reading, backing up, writing, generating random bytes)
  is an injected function with a real default, so its test suite exercises the actual rewrite
  logic without touching `/etc` or spawning a process.

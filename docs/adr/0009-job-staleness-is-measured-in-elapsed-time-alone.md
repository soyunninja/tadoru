# 0009 — A job is stale by elapsed time alone, never by whether it was attempted

Status: accepted

## Context

`/health` used to report a job's last run as a timestamp or `null`. Those two answers are
indistinguishable the moment after boot and after three days of silence, so a stopped scheduler —
no salt rotation, no rollups, no retention purging — looked exactly like a healthy fresh start.

Making the endpoint honest needs a rule for when quiet becomes broken. Two questions had to be
answered: how long is too long, and does it matter whether the job was ever attempted.

## Decision

**A job is stale when more time has passed than twice its own interval since its last successful
run.** When it has never succeeded, the clock runs from when the scheduler started rather than from
epoch zero, so a fresh boot does not report everything as broken.

**Whether a run has been attempted plays no part.** The scheduler marks a job as started before
awaiting it, which means "attempted, no success yet" is the state of a healthy run *in flight*
exactly as much as of a failed one. The first implementation treated that shape as stale, and so
reported a working nightly rollup — the slow batch the threshold exists to protect — as an outage,
on every job's first run. A test asserted that behaviour as if it were intended.

A run that threw is reported on its own field, immediately. It does not need the staleness rule to
speak for it.

## Consequences

- Silence is reported, and normal jitter is not: a slow batch, a garbage-collection pause or a
  timer firing late stays under twice the interval.
- **The cost is delay.** With a daily job, up to two days can pass before `/health` says anything
  is wrong. That is the price of not crying wolf; anyone needing tighter detection should watch the
  `lastRunAt` timestamps directly rather than the `stale` flag.
- A job that fails every single time eventually reports stale too, because no success ever resets
  its clock — which is correct, and arrives after the failure has already been visible on
  `lastRunFailed`.
- Reading "attempted" as "failed" is a mistake worth remembering: in an asynchronous system,
  *started* and *finished badly* are different states, and only one of them is a problem.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isJobStale, STALE_INTERVAL_MULTIPLIER } from './jobStaleness.ts';

const INTERVAL_MS = 1000;

test('a job that has never run and is within its first interval since start is not stale', () => {
  const stale = isJobStale({ intervalMs: INTERVAL_MS, lastRunAt: undefined }, 500, 0);
  assert.equal(stale, false);
});

test('a job that has never run and is well past its interval since start is stale', () => {
  const now = STALE_INTERVAL_MULTIPLIER * INTERVAL_MS + 1;
  const stale = isJobStale({ intervalMs: INTERVAL_MS, lastRunAt: undefined }, now, 0);
  assert.equal(stale, true);
});

test('a job that has never run and the scheduler has no recorded start time is not (yet) stale', () => {
  const stale = isJobStale({ intervalMs: INTERVAL_MS, lastRunAt: undefined }, 999_999, undefined);
  assert.equal(stale, false);
});

test('a job whose last successful run is recent is not stale', () => {
  const now = 10_000;
  const stale = isJobStale({ intervalMs: INTERVAL_MS, lastRunAt: now - 100 }, now, 0);
  assert.equal(stale, false);
});

test('a job whose last successful run is old (past the threshold) is stale', () => {
  const now = 10_000;
  const lastRunAt = now - STALE_INTERVAL_MULTIPLIER * INTERVAL_MS - 1;
  const stale = isJobStale({ intervalMs: INTERVAL_MS, lastRunAt }, now, 0);
  assert.equal(stale, true);
});

test('a first run still in flight is not an outage', () => {
  // The scheduler marks a job as having run before awaiting it, so for the whole
  // duration of a first execution the shape is "started, no success yet". That
  // is indistinguishable from a failed run by shape alone, and treating it as
  // stale flips /health to degraded while a perfectly healthy rollupBuild — the
  // slow batch this threshold exists to protect — is still working.
  const stale = isJobStale({ intervalMs: INTERVAL_MS, lastRunAt: undefined }, INTERVAL_MS, 0);
  assert.equal(stale, false);
});

test('a job that has never succeeded does go stale once it is far enough past the threshold', () => {
  const now = STALE_INTERVAL_MULTIPLIER * INTERVAL_MS + 1;
  const stale = isJobStale({ intervalMs: INTERVAL_MS, lastRunAt: undefined }, now, 0);
  assert.equal(stale, true);
});

test('exactly at the threshold is not yet stale (strictly greater-than triggers staleness)', () => {
  const now = 10_000;
  const lastRunAt = now - STALE_INTERVAL_MULTIPLIER * INTERVAL_MS;
  const stale = isJobStale({ intervalMs: INTERVAL_MS, lastRunAt }, now, 0);
  assert.equal(stale, false);
});

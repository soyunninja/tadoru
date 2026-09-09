import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTimeRange, dayStart, daysInRange, SECONDS_PER_DAY } from './TimeRange.ts';

test('creates a range aligned to UTC day boundaries', () => {
  const result = createTimeRange(1_757_320_000, 1_757_500_000); // arbitrary mid-day timestamps
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error('unreachable');
  assert.equal(result.value.startTs % SECONDS_PER_DAY, 0);
  assert.equal(result.value.endTs % SECONDS_PER_DAY, 0);
});

test('rejects a range where end is not after start', () => {
  assert.equal(createTimeRange(1_000, 1_000).ok, false);
  assert.equal(createTimeRange(2_000, 1_000).ok, false);
});

test('rejects non-finite bounds', () => {
  assert.equal(createTimeRange(Number.NaN, 1_000).ok, false);
  assert.equal(createTimeRange(0, Number.POSITIVE_INFINITY).ok, false);
});

test('dayStart floors a timestamp to the start of its UTC day', () => {
  const midDay = Date.UTC(2026, 8, 8, 15, 30, 0) / 1000;
  const startOfDay = Date.UTC(2026, 8, 8, 0, 0, 0) / 1000;
  assert.equal(dayStart(midDay), startOfDay);
});

test('daysInRange enumerates every day start in [start, end)', () => {
  const start = Date.UTC(2026, 8, 1, 0, 0, 0) / 1000;
  const end = Date.UTC(2026, 8, 4, 0, 0, 0) / 1000;
  const result = createTimeRange(start, end);
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error('unreachable');
  const days = daysInRange(result.value);
  assert.deepEqual(days, [start, start + SECONDS_PER_DAY, start + 2 * SECONDS_PER_DAY]);
});

test('a single-day range yields exactly one day', () => {
  const start = Date.UTC(2026, 8, 1, 0, 0, 0) / 1000;
  const end = start + SECONDS_PER_DAY;
  const result = createTimeRange(start, end);
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error('unreachable');
  assert.deepEqual(daysInRange(result.value), [start]);
});

import type { Result } from '../../../shared/Result.ts';
import { ok, err } from '../../../shared/Result.ts';

/**
 * A UTC day-aligned time range used for reporting. Rollups are keyed per
 * day, so a range always snaps to whole days: `startTs` is the start of its
 * containing day (inclusive), `endTs` is the start of the day after the last
 * included day (exclusive).
 */
export interface TimeRange {
  readonly startTs: number;
  readonly endTs: number;
}

export const SECONDS_PER_DAY = 86_400;

export function dayStart(ts: number): number {
  return Math.floor(ts / SECONDS_PER_DAY) * SECONDS_PER_DAY;
}

export function createTimeRange(startTs: number, endTs: number): Result<TimeRange, string> {
  if (!Number.isFinite(startTs) || !Number.isFinite(endTs)) {
    return err('TimeRange: bounds must be finite numbers');
  }
  if (endTs <= startTs) {
    return err('TimeRange: end must be after start');
  }

  const alignedStart = dayStart(startTs);
  // endTs is exclusive: align it to the start of the day that contains the
  // last included instant, then advance to the following day boundary.
  const alignedEnd = dayStart(endTs - 1) + SECONDS_PER_DAY;

  return ok({ startTs: alignedStart, endTs: alignedEnd });
}

/**
 * Enumerates the start-of-day timestamp for every day in [start, end).
 */
export function daysInRange(range: TimeRange): number[] {
  const days: number[] = [];
  for (let day = range.startTs; day < range.endTs; day += SECONDS_PER_DAY) {
    days.push(day);
  }
  return days;
}

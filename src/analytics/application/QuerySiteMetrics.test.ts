import { test } from 'node:test';
import assert from 'node:assert/strict';
import { QuerySiteMetrics } from './QuerySiteMetrics.ts';
import type { MetricsRepository } from '../domain/ports/MetricsRepository.ts';
import { FakeClock } from '../domain/ports/fakes/FakeClock.ts';
import { createSiteId } from '../domain/event/SiteId.ts';
import { createBreakdown } from '../domain/report/Breakdown.ts';
import { createTimeRange, dayStart, SECONDS_PER_DAY } from '../domain/report/TimeRange.ts';
import type { MetricRow } from '../domain/report/Metrics.ts';
import type { SiteId } from '../domain/event/SiteId.ts';
import type { TimeRange } from '../domain/report/TimeRange.ts';
import type { Breakdown } from '../domain/report/Breakdown.ts';

function site() {
  const result = createSiteId('example.com');
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error('unreachable');
  return result.value;
}

function breakdown() {
  const result = createBreakdown('path');
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error('unreachable');
  return result.value;
}

class FakeMetricsRepository implements MetricsRepository {
  rollupCalls: { site: SiteId; range: TimeRange; breakdown: Breakdown }[] = [];
  rawCalls: { site: SiteId; range: TimeRange; breakdown: Breakdown }[] = [];
  rollupRows: MetricRow[] = [];
  rawRows: MetricRow[] = [];

  queryRollup(siteId: SiteId, range: TimeRange, breakdownArg: Breakdown): Promise<readonly MetricRow[]> {
    this.rollupCalls.push({ site: siteId, range, breakdown: breakdownArg });
    return Promise.resolve(this.rollupRows);
  }

  queryRaw(siteId: SiteId, range: TimeRange, breakdownArg: Breakdown): Promise<readonly MetricRow[]> {
    this.rawCalls.push({ site: siteId, range, breakdown: breakdownArg });
    return Promise.resolve(this.rawRows);
  }
}

const TODAY = dayStart(Date.UTC(2026, 8, 10, 12, 0, 0) / 1000);

test('a range entirely before today only queries rollups, never raw events', async () => {
  const repository = new FakeMetricsRepository();
  repository.rollupRows = [{ key: '/a', pageviews: 5, visitors: 3, sessions: 3, bounces: 1, engagementSeconds: 20 }];
  const clock = new FakeClock(new Date(TODAY * 1000));
  const useCase = new QuerySiteMetrics({ metricsRepository: repository, clock });

  const range = mustCreateRange(TODAY - 3 * SECONDS_PER_DAY, TODAY);
  const rows = await useCase.execute(site(), range, breakdown());

  assert.equal(repository.rollupCalls.length, 1);
  assert.equal(repository.rawCalls.length, 0);
  assert.deepEqual(rows, repository.rollupRows);
});

test('a range that includes today queries both rollups (closed days) and raw events (today)', async () => {
  const repository = new FakeMetricsRepository();
  repository.rollupRows = [{ key: '/a', pageviews: 5, visitors: 3, sessions: 3, bounces: 1, engagementSeconds: 20 }];
  repository.rawRows = [{ key: '/a', pageviews: 2, visitors: 1, sessions: 1, bounces: 0, engagementSeconds: 5 }];
  const clock = new FakeClock(new Date(TODAY * 1000));
  const useCase = new QuerySiteMetrics({ metricsRepository: repository, clock });

  const range = mustCreateRange(TODAY - 2 * SECONDS_PER_DAY, TODAY + SECONDS_PER_DAY);
  const rows = await useCase.execute(site(), range, breakdown());

  assert.equal(repository.rollupCalls.length, 1);
  assert.equal(repository.rawCalls.length, 1);
  // Rollup range must stop at today; raw range must start at today.
  assert.equal(repository.rollupCalls[0]?.range.endTs, TODAY);
  assert.equal(repository.rawCalls[0]?.range.startTs, TODAY);

  const combined = rows.find((row) => row.key === '/a');
  assert.ok(combined !== undefined);
  assert.equal(combined.pageviews, 7);
  // Both counts are already exact per-day distinct counts (closed days from
  // the rollup, "today" straight from raw events), so summing them is sound.
  assert.equal(combined.visitors, 4);
});

test('a range entirely within today only queries raw events, never rollups', async () => {
  const repository = new FakeMetricsRepository();
  repository.rawRows = [{ key: '/a', pageviews: 1, visitors: 1, sessions: 1, bounces: 1, engagementSeconds: 0 }];
  const clock = new FakeClock(new Date(TODAY * 1000));
  const useCase = new QuerySiteMetrics({ metricsRepository: repository, clock });

  const range = mustCreateRange(TODAY, TODAY + SECONDS_PER_DAY);
  const rows = await useCase.execute(site(), range, breakdown());

  assert.equal(repository.rollupCalls.length, 0);
  assert.equal(repository.rawCalls.length, 1);
  assert.deepEqual(rows, repository.rawRows);
});

function mustCreateRange(start: number, end: number): TimeRange {
  const result = createTimeRange(start, end);
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error('unreachable');
  return result.value;
}

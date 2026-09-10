import { test } from 'node:test';
import assert from 'node:assert/strict';
import { QuerySiteScrollDepth } from './QuerySiteScrollDepth.ts';
import type { ScrollDepthRepository } from '../domain/ports/ScrollDepthRepository.ts';
import { FakeClock } from '../domain/ports/fakes/FakeClock.ts';
import { createSiteId } from '../domain/event/SiteId.ts';
import { createTimeRange, dayStart, SECONDS_PER_DAY } from '../domain/report/TimeRange.ts';
import type { ScrollDepthAggregate } from '../domain/report/ScrollDepth.ts';
import type { SiteId } from '../domain/event/SiteId.ts';
import type { TimeRange } from '../domain/report/TimeRange.ts';

function site() {
  const result = createSiteId('example.com');
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error('unreachable');
  return result.value;
}

class FakeScrollDepthRepository implements ScrollDepthRepository {
  rollupCalls: { site: SiteId; range: TimeRange }[] = [];
  rawCalls: { site: SiteId; range: TimeRange }[] = [];
  rollupRows: ScrollDepthAggregate[] = [];
  rawRows: ScrollDepthAggregate[] = [];

  queryRollup(siteId: SiteId, range: TimeRange): Promise<readonly ScrollDepthAggregate[]> {
    this.rollupCalls.push({ site: siteId, range });
    return Promise.resolve(this.rollupRows);
  }

  queryRaw(siteId: SiteId, range: TimeRange): Promise<readonly ScrollDepthAggregate[]> {
    this.rawCalls.push({ site: siteId, range });
    return Promise.resolve(this.rawRows);
  }
}

const TODAY = dayStart(Date.UTC(2026, 8, 10, 12, 0, 0) / 1000);

test('a range entirely before today only queries rollups, never raw events', async () => {
  const repository = new FakeScrollDepthRepository();
  repository.rollupRows = [{ path: '/a', depthSum: 150, sessionsWithData: 2 }];
  const clock = new FakeClock(new Date(TODAY * 1000));
  const useCase = new QuerySiteScrollDepth({ scrollDepthRepository: repository, clock });

  const range = mustCreateRange(TODAY - 3 * SECONDS_PER_DAY, TODAY);
  const rows = await useCase.execute(site(), range);

  assert.equal(repository.rollupCalls.length, 1);
  assert.equal(repository.rawCalls.length, 0);
  assert.deepEqual(rows, repository.rollupRows);
});

test('a range that includes today queries both rollups (closed days) and raw events (today), and sums additively', async () => {
  const repository = new FakeScrollDepthRepository();
  repository.rollupRows = [{ path: '/a', depthSum: 150, sessionsWithData: 2 }];
  repository.rawRows = [{ path: '/a', depthSum: 75, sessionsWithData: 1 }];
  const clock = new FakeClock(new Date(TODAY * 1000));
  const useCase = new QuerySiteScrollDepth({ scrollDepthRepository: repository, clock });

  const range = mustCreateRange(TODAY - 2 * SECONDS_PER_DAY, TODAY + SECONDS_PER_DAY);
  const rows = await useCase.execute(site(), range);

  assert.equal(repository.rollupCalls.length, 1);
  assert.equal(repository.rawCalls.length, 1);
  assert.equal(repository.rollupCalls[0]?.range.endTs, TODAY);
  assert.equal(repository.rawCalls[0]?.range.startTs, TODAY);

  const combined = rows.find((row) => row.path === '/a');
  assert.ok(combined !== undefined);
  // (150 + 75) / (2 + 1) = 75 — additive across the rollup/raw split, exactly
  // like QuerySiteMetrics combining pageviews/visitors across the same split.
  assert.equal(combined.depthSum, 225);
  assert.equal(combined.sessionsWithData, 3);
});

test('a range entirely within today only queries raw events, never rollups', async () => {
  const repository = new FakeScrollDepthRepository();
  repository.rawRows = [{ path: '/a', depthSum: 75, sessionsWithData: 1 }];
  const clock = new FakeClock(new Date(TODAY * 1000));
  const useCase = new QuerySiteScrollDepth({ scrollDepthRepository: repository, clock });

  const range = mustCreateRange(TODAY, TODAY + SECONDS_PER_DAY);
  const rows = await useCase.execute(site(), range);

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

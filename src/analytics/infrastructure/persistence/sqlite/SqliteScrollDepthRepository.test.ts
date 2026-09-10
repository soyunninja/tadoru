import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from './Database.ts';
import { SqliteEventRepository } from './SqliteEventRepository.ts';
import { SqliteSiteRegistry } from './SqliteSiteRegistry.ts';
import { SqliteScrollDepthRepository } from './SqliteScrollDepthRepository.ts';
import { SqliteRollupBuilder } from './SqliteRollupBuilder.ts';
import { createTrackedEvent } from '../../../domain/event/TrackedEvent.ts';
import type { TrackedEvent } from '../../../domain/event/TrackedEvent.ts';
import { createSiteId } from '../../../domain/event/SiteId.ts';
import { UNKNOWN_COUNTRY } from '../../../domain/event/GeoCountry.ts';
import { createTimeRange, dayStart, SECONDS_PER_DAY } from '../../../domain/report/TimeRange.ts';

function site(raw = 'example.com') {
  const result = createSiteId(raw);
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error('unreachable');
  return result.value;
}

const DAY = dayStart(Date.UTC(2026, 8, 1, 0, 0, 0) / 1000);

function visitor(n: number): Uint8Array {
  return new Uint8Array(16).fill(n);
}

function buildEvent(overrides: Partial<TrackedEvent> = {}): TrackedEvent {
  return createTrackedEvent({
    ts: DAY + 3_600,
    siteId: site(),
    visitorId: visitor(1),
    sessionId: visitor(1),
    type: 'custom',
    name: 'scroll',
    path: '/article',
    country: UNKNOWN_COUNTRY,
    deviceType: 'desktop',
    browserFamily: 'Firefox',
    osFamily: 'Linux',
    ...overrides,
  });
}

function range(startTs: number, endTs: number) {
  const result = createTimeRange(startTs, endTs);
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error('unreachable');
  return result.value;
}

test('queryRollup reads the pre-aggregated depth_sum/session_count for the requested site and range', async () => {
  const db = openDatabase(':memory:');
  const repo = new SqliteEventRepository(db);
  const registry = new SqliteSiteRegistry(db);
  const scrollDepth = new SqliteScrollDepthRepository(db, registry);

  await repo.saveBatch([
    buildEvent({ value: 25 }),
    buildEvent({ value: 50, ts: DAY + 100 }),
    buildEvent({ value: 75, ts: DAY + 200 }),
  ]);
  await new SqliteRollupBuilder(db).execute(DAY);

  const rows = await scrollDepth.queryRollup(site(), range(DAY, DAY + SECONDS_PER_DAY));

  const article = rows.find((row) => row.path === '/article');
  assert.ok(article !== undefined);
  // MAX(25, 50, 75) per session, not their average.
  assert.equal(article.depthSum, 75);
  assert.equal(article.sessionsWithData, 1);
});

test('queryRollup only returns rows for the requested site', async () => {
  const db = openDatabase(':memory:');
  const repo = new SqliteEventRepository(db);
  const registry = new SqliteSiteRegistry(db);
  const scrollDepth = new SqliteScrollDepthRepository(db, registry);

  await repo.saveBatch([
    buildEvent({ siteId: site('example.com'), path: '/only-here', value: 50 }),
    buildEvent({ siteId: site('other.com'), path: '/only-there', value: 50 }),
  ]);
  await new SqliteRollupBuilder(db).execute(DAY);

  const rows = await scrollDepth.queryRollup(site('example.com'), range(DAY, DAY + SECONDS_PER_DAY));

  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.path, '/only-here');
});

test('queryRollup returns an empty list for a site with no rollup data yet', async () => {
  const db = openDatabase(':memory:');
  const registry = new SqliteSiteRegistry(db);
  const scrollDepth = new SqliteScrollDepthRepository(db, registry);
  registry.idFor('example.com');

  const rows = await scrollDepth.queryRollup(site(), range(DAY, DAY + SECONDS_PER_DAY));

  assert.deepEqual(rows, []);
});

test('queryRaw computes the per-session maximum directly from raw events, not their average', async () => {
  const db = openDatabase(':memory:');
  const repo = new SqliteEventRepository(db);
  const registry = new SqliteSiteRegistry(db);
  const scrollDepth = new SqliteScrollDepthRepository(db, registry);

  await repo.saveBatch([
    buildEvent({ value: 25 }),
    buildEvent({ value: 50, ts: DAY + 100 }),
    buildEvent({ value: 75, ts: DAY + 200 }),
  ]);

  const rows = await scrollDepth.queryRaw(site(), range(DAY, DAY + SECONDS_PER_DAY));

  const article = rows.find((row) => row.path === '/article');
  assert.ok(article !== undefined);
  assert.equal(article.depthSum, 75);
  assert.equal(article.sessionsWithData, 1);
  assert.notEqual(article.depthSum, 50, 'must never report the naive average of the three raw milestone rows');
});

test('queryRaw sums per-session maxima across distinct sessions on the same path', async () => {
  const db = openDatabase(':memory:');
  const repo = new SqliteEventRepository(db);
  const registry = new SqliteSiteRegistry(db);
  const scrollDepth = new SqliteScrollDepthRepository(db, registry);

  await repo.saveBatch([
    buildEvent({ visitorId: visitor(1), sessionId: visitor(1), value: 100 }),
    buildEvent({ visitorId: visitor(2), sessionId: visitor(2), value: 25, ts: DAY + 100 }),
  ]);

  const rows = await scrollDepth.queryRaw(site(), range(DAY, DAY + SECONDS_PER_DAY));

  const article = rows.find((row) => row.path === '/article');
  assert.ok(article !== undefined);
  assert.equal(article.depthSum, 125);
  assert.equal(article.sessionsWithData, 2);
});

test('queryRaw ignores non-scroll events entirely', async () => {
  const db = openDatabase(':memory:');
  const repo = new SqliteEventRepository(db);
  const registry = new SqliteSiteRegistry(db);
  const scrollDepth = new SqliteScrollDepthRepository(db, registry);

  await repo.saveBatch([
    createTrackedEvent({
      ts: DAY + 3_600,
      siteId: site(),
      visitorId: visitor(1),
      sessionId: visitor(1),
      type: 'pageview',
      path: '/article',
      country: UNKNOWN_COUNTRY,
      deviceType: 'desktop',
      browserFamily: 'Firefox',
      osFamily: 'Linux',
    }),
    createTrackedEvent({
      ts: DAY + 100,
      siteId: site(),
      visitorId: visitor(1),
      sessionId: visitor(1),
      type: 'engagement',
      path: '/article',
      value: 30,
      country: UNKNOWN_COUNTRY,
      deviceType: 'desktop',
      browserFamily: 'Firefox',
      osFamily: 'Linux',
    }),
  ]);

  const rows = await scrollDepth.queryRaw(site(), range(DAY, DAY + SECONDS_PER_DAY));

  assert.deepEqual(rows, []);
});

test('queryRaw only returns rows for the requested site', async () => {
  const db = openDatabase(':memory:');
  const repo = new SqliteEventRepository(db);
  const registry = new SqliteSiteRegistry(db);
  const scrollDepth = new SqliteScrollDepthRepository(db, registry);

  await repo.saveBatch([
    buildEvent({ siteId: site('example.com'), path: '/only-here', value: 50 }),
    buildEvent({ siteId: site('other.com'), path: '/only-there', value: 50 }),
  ]);

  const rows = await scrollDepth.queryRaw(site('example.com'), range(DAY, DAY + SECONDS_PER_DAY));

  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.path, '/only-here');
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from './Database.ts';
import { SqliteEventRepository } from './SqliteEventRepository.ts';
import { SqliteSiteRegistry } from './SqliteSiteRegistry.ts';
import { SqliteMetricsRepository } from './SqliteMetricsRepository.ts';
import { SqliteRollupBuilder } from './SqliteRollupBuilder.ts';
import { createTrackedEvent } from '../../../domain/event/TrackedEvent.ts';
import type { TrackedEvent } from '../../../domain/event/TrackedEvent.ts';
import { createSiteId } from '../../../domain/event/SiteId.ts';
import { UNKNOWN_COUNTRY } from '../../../domain/event/GeoCountry.ts';
import { createTimeRange, dayStart, SECONDS_PER_DAY } from '../../../domain/report/TimeRange.ts';
import { createBreakdown } from '../../../domain/report/Breakdown.ts';

function site(raw = 'example.com') {
  const result = createSiteId(raw);
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error('unreachable');
  return result.value;
}

const DAY = dayStart(Date.UTC(2026, 8, 1, 0, 0, 0) / 1000);

function buildEvent(overrides: Partial<TrackedEvent> = {}): TrackedEvent {
  return createTrackedEvent({
    ts: DAY + 3_600,
    siteId: site(),
    visitorId: new Uint8Array(16).fill(1),
    sessionId: new Uint8Array(16).fill(2),
    type: 'pageview',
    path: '/blog/post',
    country: UNKNOWN_COUNTRY,
    deviceType: 'desktop',
    browserFamily: 'Firefox',
    osFamily: 'Linux',
    ...overrides,
  });
}

function breakdown(dimension: string) {
  const result = createBreakdown(dimension);
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error('unreachable');
  return result.value;
}

function range(startTs: number, endTs: number) {
  const result = createTimeRange(startTs, endTs);
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error('unreachable');
  return result.value;
}

test('queryRollup reads pre-aggregated rows for the requested site and range', async () => {
  const db = openDatabase(':memory:');
  const repo = new SqliteEventRepository(db);
  const registry = new SqliteSiteRegistry(db);
  const metrics = new SqliteMetricsRepository(db, registry);

  await repo.saveBatch([
    buildEvent({ path: '/a', visitorId: new Uint8Array(16).fill(1) }),
    buildEvent({ path: '/a', visitorId: new Uint8Array(16).fill(2), ts: DAY + 4_000 }),
    buildEvent({ path: '/b', visitorId: new Uint8Array(16).fill(3) }),
  ]);
  await new SqliteRollupBuilder(db).execute(DAY);

  const rows = await metrics.queryRollup(site(), range(DAY, DAY + SECONDS_PER_DAY), breakdown('path'));

  const a = rows.find((row) => row.key === '/a');
  const b = rows.find((row) => row.key === '/b');
  assert.ok(a !== undefined);
  assert.equal(a.pageviews, 2);
  assert.equal(a.visitors, 2);
  assert.ok(b !== undefined);
  assert.equal(b.pageviews, 1);
});

test('queryRollup only returns rows for the requested site', async () => {
  const db = openDatabase(':memory:');
  const repo = new SqliteEventRepository(db);
  const registry = new SqliteSiteRegistry(db);
  const metrics = new SqliteMetricsRepository(db, registry);

  await repo.saveBatch([
    buildEvent({ siteId: site('example.com'), path: '/only-here' }),
    buildEvent({ siteId: site('other.com'), path: '/only-there' }),
  ]);
  await new SqliteRollupBuilder(db).execute(DAY);

  const rows = await metrics.queryRollup(site('example.com'), range(DAY, DAY + SECONDS_PER_DAY), breakdown('path'));

  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.key, '/only-here');
});

test('queryRollup returns an empty list for a site with no rollup data yet', async () => {
  const db = openDatabase(':memory:');
  const registry = new SqliteSiteRegistry(db);
  const metrics = new SqliteMetricsRepository(db, registry);
  registry.idFor('example.com');

  const rows = await metrics.queryRollup(site(), range(DAY, DAY + SECONDS_PER_DAY), breakdown('path'));

  assert.deepEqual(rows, []);
});

test('queryRaw computes an exact distinct count directly from raw events', async () => {
  const db = openDatabase(':memory:');
  const repo = new SqliteEventRepository(db);
  const registry = new SqliteSiteRegistry(db);
  const metrics = new SqliteMetricsRepository(db, registry);

  await repo.saveBatch([
    buildEvent({ path: '/a', visitorId: new Uint8Array(16).fill(1) }),
    buildEvent({ path: '/a', visitorId: new Uint8Array(16).fill(1), ts: DAY + 4_000 }),
  ]);

  const rows = await metrics.queryRaw(site(), range(DAY, DAY + SECONDS_PER_DAY), breakdown('path'));

  const a = rows.find((row) => row.key === '/a');
  assert.ok(a !== undefined);
  assert.equal(a.pageviews, 2);
  assert.equal(a.visitors, 1);
});

test('an arbitrary dimension string can never reach the SQL: the query is always built from the allow-listed Breakdown', async () => {
  const db = openDatabase(':memory:');
  const registry = new SqliteSiteRegistry(db);
  const metrics = new SqliteMetricsRepository(db, registry);

  const { createBreakdown: create } = await import('../../../domain/report/Breakdown.ts');
  const malicious = create('path; DROP TABLE events; --');
  assert.equal(malicious.ok, false);

  // Only a validated Breakdown value (whose rollupTable/rawColumn came from
  // the fixed allow-list) can ever be passed to queryRollup/queryRaw at all
  // -- there is no code path that accepts a raw string.
  const rows = await metrics.queryRollup(site(), range(DAY, DAY + SECONDS_PER_DAY), breakdown('path'));
  assert.deepEqual(rows, []);

  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all()
    .map((row) => (row as { name: string }).name);
  assert.ok(tables.includes('events'), 'the events table must still exist');
});

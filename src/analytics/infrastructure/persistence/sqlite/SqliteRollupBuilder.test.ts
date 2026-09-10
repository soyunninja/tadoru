import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from './Database.ts';
import { SqliteEventRepository } from './SqliteEventRepository.ts';
import { SqliteRollupBuilder } from './SqliteRollupBuilder.ts';
import { createTrackedEvent } from '../../../domain/event/TrackedEvent.ts';
import type { TrackedEvent } from '../../../domain/event/TrackedEvent.ts';
import { createSiteId } from '../../../domain/event/SiteId.ts';
import { createGeoCountry, UNKNOWN_COUNTRY } from '../../../domain/event/GeoCountry.ts';
import { dayStart } from '../../../domain/report/TimeRange.ts';

function site() {
  const result = createSiteId('example.com');
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error('unreachable');
  return result.value;
}

const DAY = dayStart(Date.UTC(2026, 8, 8, 0, 0, 0) / 1000);

function buildEvent(overrides: Partial<TrackedEvent> = {}): TrackedEvent {
  return createTrackedEvent({
    ts: DAY + 3_600, // 1am into the day
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

function visitor(n: number): Uint8Array {
  return new Uint8Array(16).fill(n);
}

test('the hard part: unique visitors are computed independently per dimension, never summed across dimensions', async () => {
  const db = openDatabase(':memory:');
  const repo = new SqliteEventRepository(db);
  const rollups = new SqliteRollupBuilder(db);

  // One visitor views two different paths, both from the same country.
  await repo.saveBatch([
    buildEvent({ visitorId: visitor(1), path: '/a', country: createGeoCountry('ES'), sessionId: visitor(1) }),
    buildEvent({
      visitorId: visitor(1),
      path: '/b',
      country: createGeoCountry('ES'),
      sessionId: visitor(1),
      ts: DAY + 4_000,
    }),
  ]);

  await rollups.execute(DAY);

  const pathVisitorSum = (
    db.prepare('SELECT SUM(visitors) AS total FROM rollup_daily_path WHERE day = ?').get(DAY) as { total: number }
  ).total;
  const countryVisitorSum = (
    db.prepare('SELECT SUM(visitors) AS total FROM rollup_daily_country WHERE day = ?').get(DAY) as {
      total: number;
    }
  ).total;

  // Counted once per path -> 2 (one for /a, one for /b).
  assert.equal(pathVisitorSum, 2);
  // Same visitor, single country -> counted once, not twice.
  assert.equal(countryVisitorSum, 1);
});

test('a naive rollup that just sums pageviews per dimension row is still correct for pageviews (unlike visitors)', async () => {
  const db = openDatabase(':memory:');
  const repo = new SqliteEventRepository(db);
  const rollups = new SqliteRollupBuilder(db);

  await repo.saveBatch([
    buildEvent({ visitorId: visitor(1), path: '/a' }),
    buildEvent({ visitorId: visitor(1), path: '/a', ts: DAY + 4_000 }),
    buildEvent({ visitorId: visitor(2), path: '/b' }),
  ]);

  await rollups.execute(DAY);

  const row = db.prepare('SELECT pageviews, visitors FROM rollup_daily_path WHERE day = ? AND path = ?').get(DAY, '/a') as {
    pageviews: number;
    visitors: number;
  };
  assert.equal(row.pageviews, 2);
  assert.equal(row.visitors, 1);
});

test('sessions and bounces are computed per dimension value', async () => {
  const db = openDatabase(':memory:');
  const repo = new SqliteEventRepository(db);
  const rollups = new SqliteRollupBuilder(db);

  // Visitor 1: single pageview in one session on /a -> a bounce.
  await repo.saveBatch([buildEvent({ visitorId: visitor(1), sessionId: visitor(1), path: '/a' })]);
  // Visitor 2: two pageviews in the same session on /a -> not a bounce.
  await repo.saveBatch([
    buildEvent({ visitorId: visitor(2), sessionId: visitor(2), path: '/a', ts: DAY + 100 }),
    buildEvent({ visitorId: visitor(2), sessionId: visitor(2), path: '/a', ts: DAY + 200 }),
  ]);

  await rollups.execute(DAY);

  const row = db.prepare('SELECT sessions, bounces FROM rollup_daily_path WHERE day = ? AND path = ?').get(DAY, '/a') as {
    sessions: number;
    bounces: number;
  };
  assert.equal(row.sessions, 2);
  assert.equal(row.bounces, 1);
});

test('engagement_seconds sums engagement event values per dimension value', async () => {
  const db = openDatabase(':memory:');
  const repo = new SqliteEventRepository(db);
  const rollups = new SqliteRollupBuilder(db);

  await repo.saveBatch([
    buildEvent({ visitorId: visitor(1), path: '/a', type: 'pageview' }),
    buildEvent({ visitorId: visitor(1), path: '/a', type: 'engagement', value: 30, ts: DAY + 200 }),
    buildEvent({ visitorId: visitor(1), path: '/a', type: 'engagement', value: 15, ts: DAY + 300 }),
  ]);

  await rollups.execute(DAY);

  const row = db.prepare('SELECT engagement_seconds FROM rollup_daily_path WHERE day = ? AND path = ?').get(DAY, '/a') as {
    engagement_seconds: number;
  };
  assert.equal(row.engagement_seconds, 45);
});

test('re-running for the same day is idempotent: it replaces rows rather than doubling them', async () => {
  const db = openDatabase(':memory:');
  const repo = new SqliteEventRepository(db);
  const rollups = new SqliteRollupBuilder(db);

  await repo.saveBatch([buildEvent({ visitorId: visitor(1), path: '/a' })]);

  await rollups.execute(DAY);
  await rollups.execute(DAY);

  const rows = db.prepare('SELECT * FROM rollup_daily_path WHERE day = ? AND path = ?').all(DAY, '/a');
  assert.equal(rows.length, 1);

  const row = rows[0] as { pageviews: number; visitors: number };
  assert.equal(row.pageviews, 1);
  assert.equal(row.visitors, 1);
});

test('events from a different day are not included in this day\'s rollup', async () => {
  const db = openDatabase(':memory:');
  const repo = new SqliteEventRepository(db);
  const rollups = new SqliteRollupBuilder(db);
  const otherDay = DAY - 86_400;

  await repo.saveBatch([
    buildEvent({ visitorId: visitor(1), path: '/a', ts: DAY + 100 }),
    buildEvent({ visitorId: visitor(2), path: '/a', ts: otherDay + 100 }),
  ]);

  await rollups.execute(DAY);

  const row = db.prepare('SELECT pageviews, visitors FROM rollup_daily_path WHERE day = ? AND path = ?').get(DAY, '/a') as
    | { pageviews: number; visitors: number }
    | undefined;
  assert.ok(row !== undefined);
  assert.equal(row.pageviews, 1);
  assert.equal(row.visitors, 1);
});

test('populates all ten dimension rollup tables', async () => {
  const db = openDatabase(':memory:');
  const repo = new SqliteEventRepository(db);
  const rollups = new SqliteRollupBuilder(db);

  await repo.saveBatch([
    buildEvent({
      visitorId: visitor(1),
      path: '/a',
      referrerSource: 'Google',
      country: createGeoCountry('ES'),
      deviceType: 'mobile',
      browserFamily: 'Chrome',
      osFamily: 'Android',
      utmCampaign: 'launch',
      screenBucket: 'md',
      lang: 'es',
      colorScheme: 'dark',
    }),
  ]);

  await rollups.execute(DAY);

  for (const [table, column, value] of [
    ['rollup_daily_path', 'path', '/a'],
    ['rollup_daily_referrer', 'referrer', 'Google'],
    ['rollup_daily_country', 'country', 'ES'],
    ['rollup_daily_device', 'device', 'mobile'],
    ['rollup_daily_browser', 'browser', 'Chrome'],
    ['rollup_daily_os', 'os', 'Android'],
    ['rollup_daily_campaign', 'campaign', 'launch'],
    ['rollup_daily_screen', 'screen', 'md'],
    ['rollup_daily_language', 'language', 'es'],
    ['rollup_daily_color_scheme', 'color_scheme', 'dark'],
  ] as const) {
    const row = db.prepare(`SELECT visitors FROM ${table} WHERE day = ? AND ${column} = ?`).get(DAY, value) as
      | { visitors: number }
      | undefined;
    assert.ok(row !== undefined, `expected a row in ${table} for ${column} = ${value}`);
    assert.equal(row.visitors, 1);
  }
});

test('rebuilds rollup_daily_scroll: sums the per-session deepest-scroll maximum, not the raw milestone values', async () => {
  const db = openDatabase(':memory:');
  const repo = new SqliteEventRepository(db);
  const rollups = new SqliteRollupBuilder(db);

  // Exactly what the tracker emits for one session scrolling to 75%:
  // newlyCrossedMilestones fires once per milestone newly crossed, so three
  // raw rows land for the same path and session (25, 50, 75). AVG over the
  // raw rows would be 50 — the correct aggregate takes MAX per session (75).
  await repo.saveBatch([
    buildEvent({ visitorId: visitor(1), sessionId: visitor(1), path: '/article', type: 'custom', name: 'scroll', value: 25 }),
    buildEvent({
      visitorId: visitor(1),
      sessionId: visitor(1),
      path: '/article',
      type: 'custom',
      name: 'scroll',
      value: 50,
      ts: DAY + 100,
    }),
    buildEvent({
      visitorId: visitor(1),
      sessionId: visitor(1),
      path: '/article',
      type: 'custom',
      name: 'scroll',
      value: 75,
      ts: DAY + 200,
    }),
  ]);

  await rollups.execute(DAY);

  const row = db
    .prepare('SELECT depth_sum, session_count FROM rollup_daily_scroll WHERE day = ? AND path = ?')
    .get(DAY, '/article') as { depth_sum: number; session_count: number } | undefined;
  assert.ok(row !== undefined);
  assert.equal(row.depth_sum, 75);
  assert.equal(row.session_count, 1);
});

test('rollup_daily_scroll sums per-session maxima across distinct sessions on the same path', async () => {
  const db = openDatabase(':memory:');
  const repo = new SqliteEventRepository(db);
  const rollups = new SqliteRollupBuilder(db);

  await repo.saveBatch([
    buildEvent({ visitorId: visitor(1), sessionId: visitor(1), path: '/a', type: 'custom', name: 'scroll', value: 100 }),
    buildEvent({
      visitorId: visitor(2),
      sessionId: visitor(2),
      path: '/a',
      type: 'custom',
      name: 'scroll',
      value: 25,
      ts: DAY + 100,
    }),
  ]);

  await rollups.execute(DAY);

  const row = db
    .prepare('SELECT depth_sum, session_count FROM rollup_daily_scroll WHERE day = ? AND path = ?')
    .get(DAY, '/a') as { depth_sum: number; session_count: number } | undefined;
  assert.ok(row !== undefined);
  assert.equal(row.depth_sum, 125);
  assert.equal(row.session_count, 2);
});

test('rollup_daily_scroll ignores non-scroll events entirely', async () => {
  const db = openDatabase(':memory:');
  const repo = new SqliteEventRepository(db);
  const rollups = new SqliteRollupBuilder(db);

  await repo.saveBatch([
    buildEvent({ visitorId: visitor(1), sessionId: visitor(1), path: '/a', type: 'pageview' }),
    buildEvent({
      visitorId: visitor(1),
      sessionId: visitor(1),
      path: '/a',
      type: 'engagement',
      value: 30,
      ts: DAY + 100,
    }),
  ]);

  await rollups.execute(DAY);

  const row = db.prepare('SELECT * FROM rollup_daily_scroll WHERE day = ? AND path = ?').get(DAY, '/a');
  assert.equal(row, undefined);
});

test('re-running rollup_daily_scroll for the same day is idempotent: it replaces rows rather than doubling them', async () => {
  const db = openDatabase(':memory:');
  const repo = new SqliteEventRepository(db);
  const rollups = new SqliteRollupBuilder(db);

  await repo.saveBatch([
    buildEvent({ visitorId: visitor(1), sessionId: visitor(1), path: '/a', type: 'custom', name: 'scroll', value: 50 }),
  ]);

  await rollups.execute(DAY);
  await rollups.execute(DAY);

  const rows = db.prepare('SELECT * FROM rollup_daily_scroll WHERE day = ? AND path = ?').all(DAY, '/a');
  assert.equal(rows.length, 1);
});

test('a pixel hit carrying none of screen/language/colour-scheme rolls up under the empty key rather than vanishing', async () => {
  const db = openDatabase(':memory:');
  const repo = new SqliteEventRepository(db);
  const rollups = new SqliteRollupBuilder(db);

  // Two "noscript" pixel hits with no screen/lang/colorScheme, from
  // different visitors, must aggregate into a single empty-key row per
  // dimension rather than one row each or being dropped.
  await repo.saveBatch([
    buildEvent({ visitorId: visitor(1) }),
    buildEvent({ visitorId: visitor(2), ts: DAY + 4_000 }),
  ]);

  await rollups.execute(DAY);

  for (const [table, column] of [
    ['rollup_daily_screen', 'screen'],
    ['rollup_daily_language', 'language'],
    ['rollup_daily_color_scheme', 'color_scheme'],
  ] as const) {
    const rows = db.prepare(`SELECT ${column} AS key, visitors FROM ${table} WHERE day = ?`).all(DAY) as {
      key: string;
      visitors: number;
    }[];
    assert.equal(rows.length, 1, `expected exactly one aggregated row in ${table}`);
    assert.equal(rows[0]?.key, '');
    assert.equal(rows[0]?.visitors, 2);
  }
});

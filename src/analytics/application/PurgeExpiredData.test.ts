import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../infrastructure/persistence/sqlite/Database.ts';
import { SqliteEventRepository } from '../infrastructure/persistence/sqlite/SqliteEventRepository.ts';
import { PurgeExpiredData } from './PurgeExpiredData.ts';
import { FakeClock } from '../domain/ports/fakes/FakeClock.ts';
import { createTrackedEvent } from '../domain/event/TrackedEvent.ts';
import type { TrackedEvent } from '../domain/event/TrackedEvent.ts';
import { createSiteId } from '../domain/event/SiteId.ts';
import { UNKNOWN_COUNTRY } from '../domain/event/GeoCountry.ts';

function site() {
  const result = createSiteId('example.com');
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error('unreachable');
  return result.value;
}

function buildEvent(ts: number): TrackedEvent {
  return createTrackedEvent({
    ts,
    siteId: site(),
    visitorId: new Uint8Array(16).fill(1),
    sessionId: new Uint8Array(16).fill(2),
    type: 'pageview',
    path: '/blog/post',
    country: UNKNOWN_COUNTRY,
    deviceType: 'desktop',
    browserFamily: 'Firefox',
    osFamily: 'Linux',
  });
}

const NOW = new Date('2026-09-08T00:00:00Z');
const NOW_TS = Math.floor(NOW.getTime() / 1000);
const DEFAULT_RETENTION_MONTHS = 25;

function cutoffTsFor(retentionMonths: number, now: Date): number {
  const cutoff = new Date(now);
  cutoff.setUTCMonth(cutoff.getUTCMonth() - retentionMonths);
  return Math.floor(cutoff.getTime() / 1000);
}

test('deletes events strictly older than the retention cutoff and reports the count removed', async () => {
  const db = openDatabase(':memory:');
  const repo = new SqliteEventRepository(db);
  const clock = new FakeClock(NOW);
  const purge = new PurgeExpiredData({ eventRetention: repo, clock });

  const cutoffTs = cutoffTsFor(DEFAULT_RETENTION_MONTHS, NOW);

  await repo.saveBatch([
    buildEvent(cutoffTs - 1), // one second past retention -> deleted
    buildEvent(cutoffTs), // exactly at the boundary -> kept
    buildEvent(NOW_TS), // recent -> kept
  ]);

  const removed = await purge.execute();

  assert.equal(removed, 1);
  const remainingTimestamps = (db.prepare('SELECT ts FROM events ORDER BY ts').all() as { ts: number }[]).map(
    (row) => row.ts,
  );
  assert.deepEqual(remainingTimestamps, [cutoffTs, NOW_TS]);
});

test('defaults to a 25-month retention window', async () => {
  const db = openDatabase(':memory:');
  const repo = new SqliteEventRepository(db);
  const clock = new FakeClock(NOW);
  const purge = new PurgeExpiredData({ eventRetention: repo, clock });

  const defaultCutoff = cutoffTsFor(25, NOW);
  await repo.saveBatch([buildEvent(defaultCutoff - 1)]);

  const removed = await purge.execute();

  assert.equal(removed, 1);
});

test('honors a configured retention window other than the default', async () => {
  const db = openDatabase(':memory:');
  const repo = new SqliteEventRepository(db);
  const clock = new FakeClock(NOW);
  const purge = new PurgeExpiredData({ eventRetention: repo, clock, retentionMonths: 1 });

  const oneMonthCutoff = cutoffTsFor(1, NOW);
  await repo.saveBatch([
    buildEvent(oneMonthCutoff - 1), // deleted under 1-month retention
    buildEvent(NOW_TS), // kept
  ]);

  const removed = await purge.execute();

  assert.equal(removed, 1);
  const count = (db.prepare('SELECT COUNT(*) AS n FROM events').get() as { n: number }).n;
  assert.equal(count, 1);
});

test('never purges rollup tables', async () => {
  const db = openDatabase(':memory:');
  const repo = new SqliteEventRepository(db);
  const clock = new FakeClock(NOW);
  const purge = new PurgeExpiredData({ eventRetention: repo, clock });

  db.prepare(
    'INSERT INTO rollup_daily_path (day, site_id, path, pageviews, visitors, sessions, bounces, engagement_seconds) VALUES (0, 1, ?, 1, 1, 1, 0, 0)',
  ).run('/old');

  await purge.execute();

  const count = (db.prepare('SELECT COUNT(*) AS n FROM rollup_daily_path').get() as { n: number }).n;
  assert.equal(count, 1);
});

test('reports zero when nothing is expired', async () => {
  const db = openDatabase(':memory:');
  const repo = new SqliteEventRepository(db);
  const clock = new FakeClock(NOW);
  const purge = new PurgeExpiredData({ eventRetention: repo, clock });

  await repo.saveBatch([buildEvent(NOW_TS)]);

  const removed = await purge.execute();

  assert.equal(removed, 0);
});

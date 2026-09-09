import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from './Database.ts';
import { SqliteEventRepository } from './SqliteEventRepository.ts';
import { SqliteSiteRegistry } from './SqliteSiteRegistry.ts';
import { SqliteSiteActivityRepository } from './SqliteSiteActivityRepository.ts';
import { createTrackedEvent } from '../../../domain/event/TrackedEvent.ts';
import type { TrackedEvent } from '../../../domain/event/TrackedEvent.ts';
import { createSiteId } from '../../../domain/event/SiteId.ts';
import { UNKNOWN_COUNTRY } from '../../../domain/event/GeoCountry.ts';
import { dayStart } from '../../../domain/report/TimeRange.ts';

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

test('activityFor reports zero/null for a site the registry has never seen, not an error', async () => {
  const db = openDatabase(':memory:');
  const registry = new SqliteSiteRegistry(db);
  const activity = new SqliteSiteActivityRepository(db, registry);

  const result = await activity.activityFor(site('never-configured.example'));

  assert.deepEqual(result, { totalEvents: 0, lastEventTs: null });
});

test('activityFor reports zero/null for a registered site with no events yet', async () => {
  const db = openDatabase(':memory:');
  const registry = new SqliteSiteRegistry(db);
  registry.idFor('example.com');
  const activity = new SqliteSiteActivityRepository(db, registry);

  const result = await activity.activityFor(site());

  assert.deepEqual(result, { totalEvents: 0, lastEventTs: null });
});

test('activityFor reports the total count and the most recent event timestamp', async () => {
  const db = openDatabase(':memory:');
  const events = new SqliteEventRepository(db);
  const registry = new SqliteSiteRegistry(db);
  const activity = new SqliteSiteActivityRepository(db, registry);

  await events.saveBatch([
    buildEvent({ ts: DAY + 1_000 }),
    buildEvent({ ts: DAY + 5_000 }),
    buildEvent({ ts: DAY + 2_000 }),
  ]);

  const result = await activity.activityFor(site());

  assert.equal(result.totalEvents, 3);
  assert.equal(result.lastEventTs, DAY + 5_000);
});

test('activityFor only counts events for the requested site', async () => {
  const db = openDatabase(':memory:');
  const events = new SqliteEventRepository(db);
  const registry = new SqliteSiteRegistry(db);
  const activity = new SqliteSiteActivityRepository(db, registry);

  await events.saveBatch([
    buildEvent({ siteId: site('one.example'), ts: DAY + 1_000 }),
    buildEvent({ siteId: site('two.example'), ts: DAY + 9_000 }),
  ]);

  const result = await activity.activityFor(site('one.example'));

  assert.equal(result.totalEvents, 1);
  assert.equal(result.lastEventTs, DAY + 1_000);
});

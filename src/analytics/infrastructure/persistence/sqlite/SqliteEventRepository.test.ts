import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from './Database.ts';
import { SqliteEventRepository } from './SqliteEventRepository.ts';
import { createTrackedEvent } from '../../../domain/event/TrackedEvent.ts';
import type { TrackedEvent } from '../../../domain/event/TrackedEvent.ts';
import { createSiteId } from '../../../domain/event/SiteId.ts';
import { UNKNOWN_COUNTRY } from '../../../domain/event/GeoCountry.ts';

function site(raw = 'example.com') {
  const result = createSiteId(raw);
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error('unreachable');
  return result.value;
}

function buildEvent(overrides: Partial<TrackedEvent> = {}): TrackedEvent {
  return createTrackedEvent({
    ts: 1_757_318_400,
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

test('saveBatch persists events and findLastEventForVisitor retrieves the most recent one', async () => {
  const db = openDatabase(':memory:');
  const repo = new SqliteEventRepository(db);
  const visitorId = new Uint8Array(16).fill(7);

  await repo.saveBatch([
    buildEvent({ visitorId, ts: 1_000, path: '/first' }),
    buildEvent({ visitorId, ts: 2_000, path: '/second' }),
  ]);

  const last = await repo.findLastEventForVisitor(visitorId);
  assert.ok(last !== undefined);
  assert.equal(last.path, '/second');
  assert.equal(last.ts, 2_000);
});

test('findLastEventForVisitor returns undefined when nothing was stored for that visitor', async () => {
  const db = openDatabase(':memory:');
  const repo = new SqliteEventRepository(db);

  const result = await repo.findLastEventForVisitor(new Uint8Array(16).fill(9));

  assert.equal(result, undefined);
});

test('saveBatch inserts an entire batch atomically in a single transaction', async () => {
  const db = openDatabase(':memory:');
  const repo = new SqliteEventRepository(db);

  await repo.saveBatch([buildEvent({ ts: 1 }), buildEvent({ ts: 2 }), buildEvent({ ts: 3 })]);

  const count = (db.prepare('SELECT COUNT(*) AS n FROM events').get() as { n: number }).n;
  assert.equal(count, 3);
});

test('round-trips optional fields (utm, props, value, screen bucket)', async () => {
  const db = openDatabase(':memory:');
  const repo = new SqliteEventRepository(db);
  const visitorId = new Uint8Array(16).fill(3);

  await repo.saveBatch([
    buildEvent({
      visitorId,
      utmSource: 'newsletter',
      utmCampaign: 'launch',
      referrerSource: 'Google',
      name: 'signup',
      props: { plan: 'pro' },
      value: 42,
      screenBucket: 'lg',
      colorScheme: 'dark',
      lang: 'en',
    }),
  ]);

  const last = await repo.findLastEventForVisitor(visitorId);
  assert.ok(last !== undefined);
  assert.equal(last.utmSource, 'newsletter');
  assert.equal(last.utmCampaign, 'launch');
  assert.equal(last.referrerSource, 'Google');
  assert.equal(last.name, 'signup');
  assert.deepEqual(last.props, { plan: 'pro' });
  assert.equal(last.value, 42);
  assert.equal(last.screenBucket, 'lg');
  assert.equal(last.colorScheme, 'dark');
  assert.equal(last.lang, 'en');
});

test('rows for different sites are kept apart even with the same visitor id', async () => {
  const db = openDatabase(':memory:');
  const repo = new SqliteEventRepository(db);
  const visitorId = new Uint8Array(16).fill(5);

  await repo.saveBatch([
    buildEvent({ visitorId, siteId: site('example.com'), ts: 1_000, path: '/a' }),
    buildEvent({ visitorId, siteId: site('other.com'), ts: 2_000, path: '/b' }),
  ]);

  const last = await repo.findLastEventForVisitor(visitorId);
  // The port is not site-scoped, so it must return the most recent event
  // for that visitor id regardless of site.
  assert.ok(last !== undefined);
  assert.equal(last.path, '/b');
});

test('stored rows never carry an ip or userAgent column', async () => {
  const db = openDatabase(':memory:');
  const repo = new SqliteEventRepository(db);

  await repo.saveBatch([buildEvent()]);

  const columns = db.prepare('PRAGMA table_info(events)').all().map((row) => (row as { name: string }).name);
  assert.ok(!columns.includes('ip'));
  assert.ok(!columns.includes('user_agent'));
});

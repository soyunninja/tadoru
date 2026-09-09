import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { BatchingEventRepository } from './BatchingEventRepository.ts';
import { FakeEventRepository } from '../../../domain/ports/fakes/FakeEventRepository.ts';
import { createTrackedEvent } from '../../../domain/event/TrackedEvent.ts';
import type { TrackedEvent } from '../../../domain/event/TrackedEvent.ts';
import { createSiteId } from '../../../domain/event/SiteId.ts';
import { UNKNOWN_COUNTRY } from '../../../domain/event/GeoCountry.ts';

function site() {
  const result = createSiteId('example.com');
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error('unreachable');
  return result.value;
}

function buildEvent(overrides: Partial<TrackedEvent> = {}): TrackedEvent {
  return createTrackedEvent({
    ts: 1_000,
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

test('buffers writes and does not hit the delegate until a flush trigger', async () => {
  const delegate = new FakeEventRepository();
  const batching = new BatchingEventRepository(delegate, { maxBatchSize: 100, flushIntervalMs: 100_000 });

  await batching.saveBatch([buildEvent()]);

  assert.equal(delegate.events.length, 0);
});

test('flushes automatically once the max batch size is reached', async () => {
  const delegate = new FakeEventRepository();
  const batching = new BatchingEventRepository(delegate, { maxBatchSize: 2, flushIntervalMs: 100_000 });

  await batching.saveBatch([buildEvent({ ts: 1 })]);
  assert.equal(delegate.events.length, 0);
  await batching.saveBatch([buildEvent({ ts: 2 })]);

  assert.equal(delegate.events.length, 2);
});

test('flushes automatically after the flush interval elapses', async () => {
  const delegate = new FakeEventRepository();
  const batching = new BatchingEventRepository(delegate, { maxBatchSize: 100, flushIntervalMs: 20 });

  await batching.saveBatch([buildEvent()]);
  assert.equal(delegate.events.length, 0);

  await delay(60);

  assert.equal(delegate.events.length, 1);
});

test('flush() explicitly drains the buffer to the delegate, e.g. for shutdown', async () => {
  const delegate = new FakeEventRepository();
  const batching = new BatchingEventRepository(delegate, { maxBatchSize: 100, flushIntervalMs: 100_000 });

  await batching.saveBatch([buildEvent()]);
  assert.equal(delegate.events.length, 0);

  await batching.flush();

  assert.equal(delegate.events.length, 1);
});

test('flush() on an empty buffer is a harmless no-op', async () => {
  const delegate = new FakeEventRepository();
  const batching = new BatchingEventRepository(delegate);

  await batching.flush();

  assert.equal(delegate.events.length, 0);
});

test('defaults to a max batch size of 100 and a flush interval of 1000ms', async () => {
  const delegate = new FakeEventRepository();
  const batching = new BatchingEventRepository(delegate);

  const events = Array.from({ length: 99 }, (_, i) => buildEvent({ ts: i }));
  await batching.saveBatch(events);
  assert.equal(delegate.events.length, 0, 'must not flush before reaching 100');

  await batching.saveBatch([buildEvent({ ts: 999 })]);
  assert.equal(delegate.events.length, 100, 'must flush once 100 is reached');

  await batching.flush();
});

test('findLastEventForVisitor consults the in-memory buffer BEFORE falling back to the database: two page views in the same flush window must resolve to the same session', async () => {
  const delegate = new FakeEventRepository();
  const batching = new BatchingEventRepository(delegate, { maxBatchSize: 100, flushIntervalMs: 100_000 });
  const visitorId = new Uint8Array(16).fill(42);
  const sessionId = new Uint8Array(16).fill(99);

  // First page view lands in the buffer only — not yet flushed to the DB.
  await batching.saveBatch([buildEvent({ visitorId, sessionId, ts: 1_000, path: '/first' })]);
  assert.equal(delegate.events.length, 0, 'sanity check: still unflushed');

  // Without consulting the buffer, this would see nothing in the DB and
  // wrongly conclude "no prior event" -> a fresh session, inflating counts.
  const last = await batching.findLastEventForVisitor(visitorId);

  assert.ok(last !== undefined);
  assert.equal(last.path, '/first');
  assert.deepEqual(last.sessionId, sessionId);
});

test('findLastEventForVisitor falls back to the database when the buffer has no match', async () => {
  const delegate = new FakeEventRepository();
  const visitorId = new Uint8Array(16).fill(11);
  await delegate.saveBatch([buildEvent({ visitorId, ts: 500, path: '/from-db' })]);
  const batching = new BatchingEventRepository(delegate, { maxBatchSize: 100, flushIntervalMs: 100_000 });

  const last = await batching.findLastEventForVisitor(visitorId);

  assert.ok(last !== undefined);
  assert.equal(last.path, '/from-db');
});

test('findLastEventForVisitor prefers the most recent buffered event over an older one for the same visitor', async () => {
  const delegate = new FakeEventRepository();
  const batching = new BatchingEventRepository(delegate, { maxBatchSize: 100, flushIntervalMs: 100_000 });
  const visitorId = new Uint8Array(16).fill(3);

  await batching.saveBatch([
    buildEvent({ visitorId, ts: 1_000, path: '/older' }),
    buildEvent({ visitorId, ts: 2_000, path: '/newer' }),
  ]);

  const last = await batching.findLastEventForVisitor(visitorId);

  assert.ok(last !== undefined);
  assert.equal(last.path, '/newer');
});

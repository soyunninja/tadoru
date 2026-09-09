import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RecordEvent } from './RecordEvent.ts';
import { FakeClock } from '../domain/ports/fakes/FakeClock.ts';
import { FakeSaltProvider } from '../domain/ports/fakes/FakeSaltProvider.ts';
import { FakeGeoResolver } from '../domain/ports/fakes/FakeGeoResolver.ts';
import { FakeDeviceResolver } from '../domain/ports/fakes/FakeDeviceResolver.ts';
import { FakeEventRepository } from '../domain/ports/fakes/FakeEventRepository.ts';

function buildUseCase(overrides: { now?: Date; salt?: string; allowedSites?: readonly string[] } = {}) {
  const clock = new FakeClock(overrides.now ?? new Date('2026-09-08T10:00:00Z'));
  const saltProvider = new FakeSaltProvider(overrides.salt ?? 'salt-day-1');
  const geoResolver = new FakeGeoResolver({ '203.0.113.7': 'ES' as never });
  const deviceResolver = new FakeDeviceResolver({
    'Mozilla/5.0 Test': { type: 'desktop', browserFamily: 'Firefox', osFamily: 'Linux' },
  });
  const eventRepository = new FakeEventRepository();
  const useCase = new RecordEvent({
    clock,
    saltProvider,
    geoResolver,
    deviceResolver,
    eventRepository,
    allowedSites: overrides.allowedSites ?? ['example.com'],
  });
  return { useCase, clock, saltProvider, geoResolver, deviceResolver, eventRepository };
}

function baseRequest(overrides: Partial<Parameters<RecordEvent['execute']>[0]> = {}) {
  return {
    siteHeader: 'https://example.com',
    ip: '203.0.113.7',
    userAgent: 'Mozilla/5.0 Test',
    path: '/blog/post',
    type: 'pageview',
    ...overrides,
  };
}

test('records a pageview and persists it', async () => {
  const { useCase, eventRepository } = buildUseCase();
  const result = await useCase.execute(baseRequest());
  assert.equal(result.ok, true);
  assert.equal(eventRepository.events.length, 1);
});

test('rejects a site not on the allow-list and persists nothing', async () => {
  const { useCase, eventRepository } = buildUseCase({ allowedSites: ['other-site.com'] });
  const result = await useCase.execute(baseRequest({ siteHeader: 'https://not-allowed.com' }));
  assert.equal(result.ok, false);
  assert.equal(eventRepository.events.length, 0);
});

test('rejects an invalid event type and persists nothing', async () => {
  const { useCase, eventRepository } = buildUseCase();
  const result = await useCase.execute(baseRequest({ type: 'not-a-real-type' }));
  assert.equal(result.ok, false);
  assert.equal(eventRepository.events.length, 0);
});

test('the persisted event never carries ip or userAgent', async () => {
  const { useCase, eventRepository } = buildUseCase();
  await useCase.execute(baseRequest());
  const [event] = eventRepository.events;
  assert.ok(event);
  assert.equal(Object.prototype.hasOwnProperty.call(event, 'ip'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(event, 'userAgent'), false);
  const serialized = JSON.stringify(event);
  assert.ok(!serialized.includes('203.0.113.7'));
  assert.ok(!serialized.includes('Mozilla/5.0 Test'));
});

test('rotating the salt changes the visitor id for otherwise identical input', async () => {
  const { useCase, saltProvider, eventRepository } = buildUseCase();
  await useCase.execute(baseRequest());
  saltProvider.rotate('salt-day-2');
  await useCase.execute(baseRequest());

  assert.equal(eventRepository.events.length, 2);
  const [first, second] = eventRepository.events;
  assert.ok(first && second);
  assert.notDeepEqual(first.visitorId, second.visitorId);
});

test('resolves country and device onto the persisted event', async () => {
  const { useCase, eventRepository } = buildUseCase();
  await useCase.execute(baseRequest());
  const [event] = eventRepository.events;
  assert.ok(event);
  assert.equal(event.country, 'ES');
  assert.equal(event.deviceType, 'desktop');
  assert.equal(event.browserFamily, 'Firefox');
  assert.equal(event.osFamily, 'Linux');
});

test('sanitizes the path, keeping only allow-listed query params', async () => {
  const { useCase, eventRepository } = buildUseCase();
  await useCase.execute(baseRequest({ path: '/blog/post?utm_source=newsletter&email=a@b.com' }));
  const [event] = eventRepository.events;
  assert.ok(event);
  assert.equal(event.path, '/blog/post?utm_source=newsletter');
  assert.equal(event.utmSource, 'newsletter');
});

test('an explicit utm_source becomes the referrer source', async () => {
  const { useCase, eventRepository } = buildUseCase();
  await useCase.execute(
    baseRequest({ path: '/blog/post?utm_source=newsletter', referrer: 'https://google.com/search' }),
  );
  const [event] = eventRepository.events;
  assert.ok(event);
  assert.equal(event.referrerSource, 'newsletter');
});

test('a known referrer host maps to its canonical source name', async () => {
  const { useCase, eventRepository } = buildUseCase();
  await useCase.execute(baseRequest({ referrer: 'https://www.google.com/search' }));
  const [event] = eventRepository.events;
  assert.ok(event);
  assert.equal(event.referrerSource, 'Google');
});

test('an absent referrer resolves to a direct source', async () => {
  const { useCase, eventRepository } = buildUseCase();
  await useCase.execute(baseRequest());
  const [event] = eventRepository.events;
  assert.ok(event);
  assert.equal(event.referrerSource, 'direct');
});

test('keeps the same session for a second event within the 30 minute window', async () => {
  const { useCase, clock, eventRepository } = buildUseCase();
  await useCase.execute(baseRequest());
  clock.setNow(new Date('2026-09-08T10:15:00Z'));
  await useCase.execute(baseRequest({ path: '/blog/other' }));

  assert.equal(eventRepository.events.length, 2);
  const [first, second] = eventRepository.events;
  assert.ok(first && second);
  assert.deepEqual(first.sessionId, second.sessionId);
});

test('starts a new session once the 30 minute window has passed', async () => {
  const { useCase, clock, eventRepository } = buildUseCase();
  await useCase.execute(baseRequest());
  clock.setNow(new Date('2026-09-08T10:45:00Z'));
  await useCase.execute(baseRequest({ path: '/blog/other' }));

  assert.equal(eventRepository.events.length, 2);
  const [first, second] = eventRepository.events;
  assert.ok(first && second);
  assert.notDeepEqual(first.sessionId, second.sessionId);
});

test('allows localhost as a configured site, for local development', async () => {
  const { useCase, eventRepository } = buildUseCase({ allowedSites: ['localhost'] });
  const result = await useCase.execute(baseRequest({ siteHeader: 'http://localhost:3000' }));
  assert.equal(result.ok, true);
  assert.equal(eventRepository.events.length, 1);
});

test('treats a site differing only by www. or scheme as the same allowed site', async () => {
  const { useCase, eventRepository } = buildUseCase({ allowedSites: ['example.com'] });
  const result = await useCase.execute(baseRequest({ siteHeader: 'https://www.example.com' }));
  assert.equal(result.ok, true);
  assert.equal(eventRepository.events.length, 1);
});

test('buckets the screen width instead of storing the exact pixel value', async () => {
  const { useCase, eventRepository } = buildUseCase();
  await useCase.execute(baseRequest({ screenWidth: 1300 } as never));
  const [event] = eventRepository.events;
  assert.ok(event);
  assert.equal(event.screenBucket, 'xl');
});

test('carries an optional custom event name, props and value', async () => {
  const { useCase, eventRepository } = buildUseCase();
  await useCase.execute(baseRequest({ type: 'custom', name: 'signup', props: { plan: 'pro' }, value: 1 } as never));
  const [event] = eventRepository.events;
  assert.ok(event);
  assert.equal(event.name, 'signup');
  assert.deepEqual(event.props, { plan: 'pro' });
  assert.equal(event.value, 1);
});

test('an explicit screenBucket takes precedence over screenWidth', async () => {
  const { useCase, eventRepository } = buildUseCase();
  await useCase.execute(baseRequest({ screenBucket: 'sm', screenWidth: 1300 } as never));
  const [event] = eventRepository.events;
  assert.ok(event);
  assert.equal(event.screenBucket, 'sm');
});

test('an invalid screenBucket falls back to bucketing screenWidth', async () => {
  const { useCase, eventRepository } = buildUseCase();
  await useCase.execute(baseRequest({ screenBucket: 'not-a-bucket', screenWidth: 1300 } as never));
  const [event] = eventRepository.events;
  assert.ok(event);
  assert.equal(event.screenBucket, 'xl');
});

test('the device is derived from exactly the user agent that feeds the visitor id', async () => {
  // The headline "Visitors" figure is the sum of the device breakdown, and that
  // is only exact because one visitor id can never span two device values: the
  // id hashes the user agent, and the device is a function of that same string.
  //
  // Adding another input to device resolution — client hints, most likely —
  // without adding it to the hash would silently break the headline, since two
  // events could then share an id but land in different device rows. This test
  // makes that a red suite instead of a wrong number on a page.
  const seen: readonly unknown[][] = [];
  const calls: unknown[][] = seen as unknown[][];
  const spyResolver = {
    resolve(...args: unknown[]) {
      calls.push(args);
      return { type: 'desktop', browserFamily: 'Chrome', osFamily: 'Windows' } as const;
    },
  };

  const clock = new FakeClock(new Date('2026-09-08T10:00:00Z'));
  const useCase = new RecordEvent({
    clock,
    saltProvider: new FakeSaltProvider('salt-day-1'),
    geoResolver: new FakeGeoResolver({ '203.0.113.7': 'ES' as never }),
    deviceResolver: spyResolver as never,
    eventRepository: new FakeEventRepository(),
    allowedSites: ['example.com'],
  });

  const userAgent = 'Mozilla/5.0 (Windows NT 10.0) Chrome/120.0.0.0';
  await useCase.execute(baseRequest({ userAgent }));

  assert.equal(calls.length, 1, 'the resolver should be consulted once');
  assert.deepEqual(
    calls[0],
    [userAgent],
    'the resolver must receive the user agent and nothing else — any extra input would have to join the visitor id hash too',
  );
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTrackedEvent } from './TrackedEvent.ts';
import type { TrackedEvent } from './TrackedEvent.ts';
import { createSiteId } from './SiteId.ts';
import { UNKNOWN_COUNTRY } from './GeoCountry.ts';

function site() {
  const result = createSiteId('example.com');
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error('unreachable');
  return result.value;
}

function baseFields() {
  return {
    ts: 1_757_318_400,
    siteId: site(),
    visitorId: new Uint8Array(16).fill(1),
    sessionId: new Uint8Array(16).fill(2),
    type: 'pageview' as const,
    path: '/blog/post',
    country: UNKNOWN_COUNTRY,
    deviceType: 'desktop' as const,
    browserFamily: 'Firefox',
    osFamily: 'Linux',
  };
}

test('builds a TrackedEvent from its fields', () => {
  const event = createTrackedEvent(baseFields());
  assert.equal(event.path, '/blog/post');
  assert.equal(event.type, 'pageview');
});

test('never has an ip property, even if the raw input smuggled one in', () => {
  const tainted = { ...baseFields(), ip: '203.0.113.7' } as unknown as TrackedEvent;
  const event = createTrackedEvent(tainted);
  assert.equal(Object.prototype.hasOwnProperty.call(event, 'ip'), false);
  assert.ok(!Object.keys(event).includes('ip'));
});

test('never has a userAgent property, even if the raw input smuggled one in', () => {
  const tainted = { ...baseFields(), userAgent: 'Mozilla/5.0 Test' } as unknown as TrackedEvent;
  const event = createTrackedEvent(tainted);
  assert.equal(Object.prototype.hasOwnProperty.call(event, 'userAgent'), false);
  assert.ok(!Object.keys(event).includes('userAgent'));
});

test('a JSON round-trip never surfaces ip or userAgent', () => {
  const tainted = { ...baseFields(), ip: '203.0.113.7', userAgent: 'Mozilla/5.0 Test' } as unknown as TrackedEvent;
  const event = createTrackedEvent(tainted);
  const serialized = JSON.stringify(event);
  assert.ok(!serialized.includes('203.0.113.7'));
  assert.ok(!serialized.includes('Mozilla/5.0 Test'));
  const parsed = JSON.parse(serialized);
  assert.equal(Object.prototype.hasOwnProperty.call(parsed, 'ip'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(parsed, 'userAgent'), false);
});

test('carries optional utm and engagement fields when provided', () => {
  const event = createTrackedEvent({
    ...baseFields(),
    utmSource: 'newsletter',
    referrerSource: 'Google',
    name: 'signup',
    props: { plan: 'pro' },
    value: 42,
  });
  assert.equal(event.utmSource, 'newsletter');
  assert.equal(event.referrerSource, 'Google');
  assert.equal(event.name, 'signup');
  assert.deepEqual(event.props, { plan: 'pro' });
  assert.equal(event.value, 42);
});

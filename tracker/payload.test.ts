import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPageviewPayload, newlyCrossedMilestones, createEngagementTimer, PAYLOAD_KEYS } from './payload.ts';

test('builds a pageview payload from the page context', () => {
  const payload = buildPageviewPayload({
    href: 'https://example.com/blog/post?utm_source=news&secret=abc#frag',
    referrer: 'https://google.com/search?q=x',
    screenWidth: 1440,
    colorScheme: 'dark',
    lang: 'es-ES',
  });
  assert.equal(payload.type, 'pageview');
  assert.equal(payload.path, '/blog/post?utm_source=news');
  assert.equal(payload.referrer, 'https://google.com/search?q=x');
  assert.equal(payload.colorScheme, 'dark');
  assert.equal(payload.lang, 'es-ES');
});

// Anti-fingerprinting: the exact width must never leave the device.
test('sends a screen bucket and never the exact width', () => {
  const payload = buildPageviewPayload({
    href: 'https://example.com/',
    referrer: '',
    screenWidth: 1443,
    colorScheme: 'light',
    lang: 'en',
  });
  assert.equal(payload.screenBucket, 'xl');
  assert.ok(!('screenWidth' in payload));
  assert.ok(!JSON.stringify(payload).includes('1443'));
});

// The payload schema is a closed list. Adding a fingerprinting signal must
// require deliberately editing this allow-list, never happen by accident.
test('the payload schema is closed against fingerprinting signals', () => {
  const forbidden = [
    'canvas', 'webgl', 'fonts', 'timezone', 'timeZone', 'resolution',
    'plugins', 'hardwareConcurrency', 'deviceMemory', 'userAgent', 'ip',
  ];
  for (const key of forbidden) {
    assert.ok(!(PAYLOAD_KEYS as readonly string[]).includes(key), `payload must not carry ${key}`);
  }
});

test('every key a payload emits is declared in the schema', () => {
  const payload = buildPageviewPayload({
    href: 'https://example.com/x', referrer: '', screenWidth: 800, colorScheme: 'light', lang: 'en',
  });
  for (const key of Object.keys(payload)) {
    assert.ok((PAYLOAD_KEYS as readonly string[]).includes(key), `undeclared payload key: ${key}`);
  }
});

test('reports each scroll milestone once and never goes backwards', () => {
  assert.deepEqual(newlyCrossedMilestones(0, 30), [25]);
  assert.deepEqual(newlyCrossedMilestones(25, 80), [50, 75]);
  assert.deepEqual(newlyCrossedMilestones(75, 100), [100]);
  assert.deepEqual(newlyCrossedMilestones(100, 40), []);
  assert.deepEqual(newlyCrossedMilestones(50, 50), []);
});

test('accumulates only visible time', () => {
  let now = 1000;
  const timer = createEngagementTimer(() => now);
  now = 4000;
  timer.hide();                       // 3s visible
  now = 9000;                         // 5s hidden, must not count
  timer.show();
  now = 11000;
  assert.equal(timer.visibleSeconds(), 5);   // 3s + 2s
});

test('a page never shown accumulates nothing', () => {
  let now = 1000;
  const timer = createEngagementTimer(() => now);
  timer.hide();
  now = 60000;
  assert.equal(timer.visibleSeconds(), 0);
});

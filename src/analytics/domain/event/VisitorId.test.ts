import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveVisitorId } from './VisitorId.ts';

const base = { salt: 'salt-2026-09-08', siteId: 'example.com', ip: '203.0.113.7', userAgent: 'Mozilla/5.0 Test' };

test('is a 16-byte buffer', () => {
  const id = deriveVisitorId(base);
  assert.ok(id instanceof Uint8Array);
  assert.equal(id.length, 16);
});

test('same inputs produce the same visitor id', () => {
  const a = deriveVisitorId(base);
  const b = deriveVisitorId({ ...base });
  assert.deepEqual(a, b);
});

test('a different salt produces a different visitor id', () => {
  const a = deriveVisitorId(base);
  const b = deriveVisitorId({ ...base, salt: 'salt-2026-09-09' });
  assert.notDeepEqual(a, b);
});

test('a different site produces a different visitor id (no cross-site correlation)', () => {
  const a = deriveVisitorId(base);
  const b = deriveVisitorId({ ...base, siteId: 'other-site.com' });
  assert.notDeepEqual(a, b);
});

test('a different ip produces a different visitor id', () => {
  const a = deriveVisitorId(base);
  const b = deriveVisitorId({ ...base, ip: '203.0.113.8' });
  assert.notDeepEqual(a, b);
});

test('a different user agent produces a different visitor id', () => {
  const a = deriveVisitorId(base);
  const b = deriveVisitorId({ ...base, userAgent: 'Mozilla/5.0 Other' });
  assert.notDeepEqual(a, b);
});

test('different field splits of the same concatenation do not collide', () => {
  // "ab" + "c" must not hash the same as "a" + "bc" once fields are combined.
  const a = deriveVisitorId({ salt: 'ab', siteId: 'c', ip: '1.1.1.1', userAgent: 'ua' });
  const b = deriveVisitorId({ salt: 'a', siteId: 'bc', ip: '1.1.1.1', userAgent: 'ua' });
  assert.notDeepEqual(a, b);
});

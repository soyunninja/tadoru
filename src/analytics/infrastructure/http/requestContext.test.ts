import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveClientIp, resolveSiteHeader, resolveClientHints } from './requestContext.ts';

test('resolveClientIp returns the socket address when trustedProxy is false', () => {
  const ip = resolveClientIp({ 'x-forwarded-for': '203.0.113.7' }, '198.51.100.1', false);
  assert.equal(ip, '198.51.100.1');
});

test('resolveClientIp ignores X-Forwarded-For entirely when trustedProxy is false, even if present', () => {
  // Regression guard: trusting this header without a proxy in front lets any
  // caller forge their own IP (and therefore their country).
  const ip = resolveClientIp(
    { 'x-forwarded-for': '203.0.113.7, 10.0.0.1' },
    '198.51.100.1',
    false,
  );
  assert.equal(ip, '198.51.100.1');
  assert.notEqual(ip, '203.0.113.7');
});

test('resolveClientIp uses the first X-Forwarded-For entry when trustedProxy is true', () => {
  const ip = resolveClientIp(
    { 'x-forwarded-for': '203.0.113.7, 10.0.0.1' },
    '198.51.100.1',
    true,
  );
  assert.equal(ip, '203.0.113.7');
});

test('resolveClientIp falls back to the socket address when trustedProxy is true but the header is absent', () => {
  const ip = resolveClientIp({}, '198.51.100.1', true);
  assert.equal(ip, '198.51.100.1');
});

test('resolveClientIp handles an array header value by taking the first entry', () => {
  const ip = resolveClientIp({ 'x-forwarded-for': ['203.0.113.7', '10.0.0.1'] }, '198.51.100.1', true);
  assert.equal(ip, '203.0.113.7');
});

test('resolveSiteHeader prefers Origin', () => {
  const site = resolveSiteHeader({ origin: 'https://example.com', referer: 'https://other.com/page' });
  assert.equal(site, 'https://example.com');
});

test('resolveSiteHeader falls back to Referer when Origin is absent', () => {
  const site = resolveSiteHeader({ referer: 'https://example.com/page' });
  assert.equal(site, 'https://example.com/page');
});

test('resolveSiteHeader returns undefined when neither header is present', () => {
  const site = resolveSiteHeader({});
  assert.equal(site, undefined);
});

test('resolveClientHints reads sec-ch-ua headers when present', () => {
  const hints = resolveClientHints({
    'sec-ch-ua': '"Chromium";v="131"',
    'sec-ch-ua-platform': '"Linux"',
    'sec-ch-ua-mobile': '?0',
  });
  assert.deepEqual(hints, {
    'sec-ch-ua': '"Chromium";v="131"',
    'sec-ch-ua-platform': '"Linux"',
    'sec-ch-ua-mobile': '?0',
  });
});

test('resolveClientHints returns an empty object when no client hints are present', () => {
  assert.deepEqual(resolveClientHints({}), {});
});

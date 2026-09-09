import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSiteId } from './SiteId.ts';

test('accepts a bare host', () => {
  const result = createSiteId('example.com');
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.value, 'example.com');
});

test('accepts a full URL and extracts the host', () => {
  const result = createSiteId('https://example.com/blog/post?x=1');
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.value, 'example.com');
});

test('lowercases the host', () => {
  const result = createSiteId('EXAMPLE.com');
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.value, 'example.com');
});

test('strips a trailing dot', () => {
  const result = createSiteId('example.com.');
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.value, 'example.com');
});

test('strips a leading www.', () => {
  const result = createSiteId('www.example.com');
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.value, 'example.com');
});

test('strips the port from a bare host', () => {
  const result = createSiteId('example.com:8080');
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.value, 'example.com');
});

test('strips the port from a full URL', () => {
  const result = createSiteId('https://example.com:8080/path');
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.value, 'example.com');
});

test('allows localhost', () => {
  const result = createSiteId('localhost');
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.value, 'localhost');
});

test('two sites differing only by www. are the same SiteId', () => {
  const a = createSiteId('www.example.com');
  const b = createSiteId('example.com');
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  if (a.ok && b.ok) assert.equal(a.value, b.value);
});

test('two sites differing only by scheme are the same SiteId', () => {
  const a = createSiteId('http://example.com');
  const b = createSiteId('https://example.com');
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  if (a.ok && b.ok) assert.equal(a.value, b.value);
});

test('rejects an empty value', () => {
  assert.equal(createSiteId('').ok, false);
  assert.equal(createSiteId('   ').ok, false);
});

test('rejects an IPv4 literal', () => {
  assert.equal(createSiteId('192.168.1.1').ok, false);
});

test('rejects an IPv6 literal', () => {
  assert.equal(createSiteId('http://[::1]/').ok, false);
  assert.equal(createSiteId('::1').ok, false);
});

test('rejects a value containing whitespace', () => {
  assert.equal(createSiteId('example.com/../ evil').ok, false);
  assert.equal(createSiteId('exa mple.com').ok, false);
});

test('rejects a value containing path traversal', () => {
  assert.equal(createSiteId('example.com/../secret').ok, false);
  assert.equal(createSiteId('../etc/passwd').ok, false);
});

test('rejects a host longer than 253 characters', () => {
  const longHost = 'a'.repeat(250) + '.com';
  assert.ok(longHost.length > 253);
  assert.equal(createSiteId(longHost).ok, false);
});

test('accepts a host at exactly 253 characters', () => {
  // 249 'a' chars + '.' + 'com' (3) = 253 total, all in one long label plus a TLD.
  const host = `${'a'.repeat(249)}.com`;
  assert.equal(host.length, 253);
  const result = createSiteId(host);
  assert.equal(result.ok, true);
});

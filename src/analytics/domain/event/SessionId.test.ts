import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateSessionId, belongsToSameSession, SESSION_INACTIVITY_WINDOW_MS } from './SessionId.ts';

test('generates a random 16-byte id', () => {
  const id = generateSessionId();
  assert.ok(id instanceof Uint8Array);
  assert.equal(id.length, 16);
});

test('two generated ids are (virtually certainly) different', () => {
  const a = generateSessionId();
  const b = generateSessionId();
  assert.notDeepEqual(a, b);
});

test('the inactivity window is exactly 30 minutes', () => {
  assert.equal(SESSION_INACTIVITY_WINDOW_MS, 30 * 60 * 1000);
});

test('same session when the gap is well within 30 minutes', () => {
  const lastSeenAt = new Date('2026-09-08T10:00:00Z');
  const now = new Date('2026-09-08T10:15:00Z');
  assert.equal(belongsToSameSession(lastSeenAt, now), true);
});

test('same session at exactly the 30 minute boundary (inclusive)', () => {
  const lastSeenAt = new Date('2026-09-08T10:00:00Z');
  const now = new Date('2026-09-08T10:30:00Z');
  assert.equal(belongsToSameSession(lastSeenAt, now), true);
});

test('new session one millisecond past the 30 minute boundary', () => {
  const lastSeenAt = new Date('2026-09-08T10:00:00Z');
  const now = new Date('2026-09-08T10:30:00.001Z');
  assert.equal(belongsToSameSession(lastSeenAt, now), false);
});

test('new session well beyond the window', () => {
  const lastSeenAt = new Date('2026-09-08T10:00:00Z');
  const now = new Date('2026-09-08T12:00:00Z');
  assert.equal(belongsToSameSession(lastSeenAt, now), false);
});

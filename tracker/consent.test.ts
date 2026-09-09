import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldTrack } from './consent.ts';

const allowed = {
  doNotTrack: null,
  globalPrivacyControl: undefined,
  hostname: 'example.com',
  protocol: 'https:',
  visibilityState: 'visible',
} as const;

test('tracks an ordinary visitor', () => {
  assert.equal(shouldTrack(allowed), true);
});

// The privacy notice we ship promises that Do Not Track prevents measurement.
// These tests are what make that promise true.
test('honours Do Not Track set to "1"', () => {
  assert.equal(shouldTrack({ ...allowed, doNotTrack: '1' }), false);
});

test('honours Do Not Track set to "yes"', () => {
  assert.equal(shouldTrack({ ...allowed, doNotTrack: 'yes' }), false);
});

test('ignores Do Not Track set to "0" or "unspecified"', () => {
  assert.equal(shouldTrack({ ...allowed, doNotTrack: '0' }), true);
  assert.equal(shouldTrack({ ...allowed, doNotTrack: 'unspecified' }), true);
});

test('honours Global Privacy Control', () => {
  assert.equal(shouldTrack({ ...allowed, globalPrivacyControl: true }), false);
});

test('does not track a prerendered page', () => {
  assert.equal(shouldTrack({ ...allowed, visibilityState: 'prerender' }), false);
});

test('does not track file:// pages', () => {
  assert.equal(shouldTrack({ ...allowed, protocol: 'file:' }), false);
});

test('does not track localhost, so development noise stays out of the data', () => {
  assert.equal(shouldTrack({ ...allowed, hostname: 'localhost' }), false);
  assert.equal(shouldTrack({ ...allowed, hostname: '127.0.0.1' }), false);
});

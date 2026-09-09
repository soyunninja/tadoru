import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEVICE_TYPES, isDeviceType } from './DeviceProfile.ts';
import type { DeviceProfile } from './DeviceProfile.ts';

test('DEVICE_TYPES lists every supported device type', () => {
  assert.deepEqual(DEVICE_TYPES, ['desktop', 'mobile', 'tablet', 'tv', 'bot', 'unknown']);
});

test('isDeviceType accepts every listed type and rejects unknown strings', () => {
  for (const type of DEVICE_TYPES) {
    assert.equal(isDeviceType(type), true);
  }
  assert.equal(isDeviceType('phone'), false);
});

test('a DeviceProfile only ever retains browser and OS families, never full version strings', () => {
  const profile: DeviceProfile = { type: 'desktop', browserFamily: 'Chrome', osFamily: 'Windows' };
  const serialized = JSON.stringify(profile);
  assert.ok(!/\d+\.\d+\.\d+/.test(serialized), 'must not contain a dotted version number');
  assert.ok(!serialized.includes('131.0.6778.86'));
  assert.equal(profile.browserFamily, 'Chrome');
});

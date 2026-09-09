import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deviceIcon } from './device.ts';
import { DEVICE_TYPES } from '../../../domain/event/DeviceProfile.ts';

test('covers every device type the domain can produce', () => {
  assert.equal(deviceIcon('desktop'), '\u{f108}');
  assert.equal(deviceIcon('mobile'), '\u{f10b}');
  assert.equal(deviceIcon('tablet'), '\u{f10a}');
  assert.equal(deviceIcon('tv'), '\u{f26c}');
  // An automated client is not a device anyone holds; a terminal says that.
  assert.equal(deviceIcon('bot'), '\u{f120}');
  assert.equal(deviceIcon('unknown'), '');
});

test('never throws, and no domain device type is left unhandled', () => {
  for (const type of DEVICE_TYPES) {
    assert.doesNotThrow(() => deviceIcon(type));
    if (type !== 'unknown') {
      assert.notEqual(deviceIcon(type), '', `${type} should have an icon`);
    }
  }
});

test('every icon sits in the Font Awesome range the licence notice covers', () => {
  for (const type of DEVICE_TYPES) {
    const icon = deviceIcon(type);
    if (icon === '') continue;
    const codepoint = icon.codePointAt(0);
    assert.ok(codepoint !== undefined && codepoint >= 0xf000 && codepoint <= 0xf2ff);
  }
});

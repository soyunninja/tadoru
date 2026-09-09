import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NodeDeviceDetectorResolver } from './NodeDeviceDetectorResolver.ts';

const CHROME_WINDOWS_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.6778.86 Safari/537.36';
const ANDROID_UA =
  'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';
const IPAD_UA = 'Mozilla/5.0 (iPad; CPU OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1';
const GOOGLEBOT_UA = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';

test('classifies a desktop browser and strips the version from browser and OS families', () => {
  const resolver = new NodeDeviceDetectorResolver();
  const profile = resolver.resolve(CHROME_WINDOWS_UA);
  assert.equal(profile.type, 'desktop');
  assert.equal(profile.browserFamily, 'Chrome');
  assert.equal(profile.osFamily, 'Windows');
  assert.ok(!profile.browserFamily.includes('131'));
  assert.ok(!profile.osFamily.includes('10.0'));
});

test('classifies a phone as mobile', () => {
  const resolver = new NodeDeviceDetectorResolver();
  const profile = resolver.resolve(ANDROID_UA);
  assert.equal(profile.type, 'mobile');
  assert.equal(profile.osFamily, 'Android');
});

test('classifies a tablet as tablet', () => {
  const resolver = new NodeDeviceDetectorResolver();
  const profile = resolver.resolve(IPAD_UA);
  assert.equal(profile.type, 'tablet');
});

test('classifies a known crawler as a bot, without a version string', () => {
  const resolver = new NodeDeviceDetectorResolver();
  const profile = resolver.resolve(GOOGLEBOT_UA);
  assert.equal(profile.type, 'bot');
});

test('falls back to unknown for an empty or unrecognisable user agent', () => {
  const resolver = new NodeDeviceDetectorResolver();
  const profile = resolver.resolve('');
  assert.equal(profile.type, 'unknown');
  assert.equal(profile.browserFamily, 'unknown');
  assert.equal(profile.osFamily, 'unknown');
});

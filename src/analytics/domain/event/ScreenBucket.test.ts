import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bucketScreenWidth, SCREEN_BUCKETS } from './ScreenBucket.ts';

test('widths below 640 bucket as xs', () => {
  assert.equal(bucketScreenWidth(0), 'xs');
  assert.equal(bucketScreenWidth(639), 'xs');
});

test('boundary at 640 buckets as sm', () => {
  assert.equal(bucketScreenWidth(640), 'sm');
  assert.equal(bucketScreenWidth(767), 'sm');
});

test('boundary at 768 buckets as md', () => {
  assert.equal(bucketScreenWidth(768), 'md');
  assert.equal(bucketScreenWidth(1023), 'md');
});

test('boundary at 1024 buckets as lg', () => {
  assert.equal(bucketScreenWidth(1024), 'lg');
  assert.equal(bucketScreenWidth(1279), 'lg');
});

test('boundary at 1280 buckets as xl', () => {
  assert.equal(bucketScreenWidth(1280), 'xl');
  assert.equal(bucketScreenWidth(1535), 'xl');
});

test('boundary at 1536 and above buckets as 2xl', () => {
  assert.equal(bucketScreenWidth(1536), '2xl');
  assert.equal(bucketScreenWidth(4000), '2xl');
});

test('SCREEN_BUCKETS lists every bucket in order', () => {
  assert.deepEqual(SCREEN_BUCKETS, ['xs', 'sm', 'md', 'lg', 'xl', '2xl']);
});

test('the exact pixel width is unrecoverable from the bucket — an anti-fingerprinting control', () => {
  const widths = [1300, 1400, 1279, 1024];
  const buckets = widths.map(bucketScreenWidth);
  // Multiple distinct exact widths collapse onto the same bucket, so the
  // bucket alone cannot be inverted back to a single exact width.
  assert.equal(buckets[0], buckets[1]);
  assert.notEqual(new Set(buckets).size, widths.length);
});

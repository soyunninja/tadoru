import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TokenBucketRateLimiter } from './rateLimit.ts';

test('allows requests up to the burst capacity', () => {
  const limiter = new TokenBucketRateLimiter({ capacity: 3, refillPerMinute: 60 });
  assert.equal(limiter.consume('example.com', '203.0.113.7'), true);
  assert.equal(limiter.consume('example.com', '203.0.113.7'), true);
  assert.equal(limiter.consume('example.com', '203.0.113.7'), true);
  assert.equal(limiter.consume('example.com', '203.0.113.7'), false);
});

test('refills tokens over time', () => {
  let now = 0;
  const limiter = new TokenBucketRateLimiter({ capacity: 1, refillPerMinute: 60 }, { now: () => now });
  assert.equal(limiter.consume('example.com', '203.0.113.7'), true);
  assert.equal(limiter.consume('example.com', '203.0.113.7'), false);

  now += 60_000; // one full minute later: 60/min refill rate means one token back
  assert.equal(limiter.consume('example.com', '203.0.113.7'), true);
});

test('keys are scoped per site, so the same IP on two sites has independent buckets', () => {
  const limiter = new TokenBucketRateLimiter({ capacity: 1, refillPerMinute: 60 });
  assert.equal(limiter.consume('site-a.com', '203.0.113.7'), true);
  assert.equal(limiter.consume('site-b.com', '203.0.113.7'), true);
});

test('keys are scoped per IP, so two different visitors on one site have independent buckets', () => {
  const limiter = new TokenBucketRateLimiter({ capacity: 1, refillPerMinute: 60 });
  assert.equal(limiter.consume('example.com', '203.0.113.7'), true);
  assert.equal(limiter.consume('example.com', '198.51.100.9'), true);
});

test('never stores the raw IP address, only a hash of it', () => {
  const limiter = new TokenBucketRateLimiter({ capacity: 5, refillPerMinute: 60 });
  limiter.consume('example.com', '203.0.113.7');
  const keys = limiter.debugKeys();
  assert.equal(keys.length, 1);
  assert.ok(!(keys[0] ?? '').includes('203.0.113.7'));
});

test('evicts entries that have been idle past the ttl, so the map cannot grow unbounded', () => {
  let now = 0;
  const limiter = new TokenBucketRateLimiter({ capacity: 5, refillPerMinute: 60, ttlMs: 1000 }, { now: () => now });
  limiter.consume('example.com', '203.0.113.7');
  assert.equal(limiter.size(), 1);

  now += 2000; // past the ttl
  limiter.consume('other-site.com', '198.51.100.9'); // triggers a sweep as a side effect
  assert.equal(limiter.size(), 1); // the stale entry was evicted; only the fresh one remains
});

test('does not evict an entry that was used recently', () => {
  let now = 0;
  const limiter = new TokenBucketRateLimiter({ capacity: 5, refillPerMinute: 60, ttlMs: 10_000 }, { now: () => now });
  limiter.consume('example.com', '203.0.113.7');

  now += 500;
  limiter.consume('example.com', '203.0.113.7');

  now += 500;
  limiter.consume('other-site.com', '198.51.100.9');

  assert.equal(limiter.size(), 2);
});

import { createHash } from 'node:crypto';

const DEFAULT_CAPACITY = 60;
const DEFAULT_REFILL_PER_MINUTE = 60;
const DEFAULT_TTL_MS = 10 * 60 * 1000;

export interface RateLimiterOptions {
  /** Burst size: the maximum number of tokens (and events) a key can spend at once. */
  readonly capacity?: number;
  /** Sustained rate: tokens restored per minute. */
  readonly refillPerMinute?: number;
  /** How long an idle bucket survives before it is evicted. */
  readonly ttlMs?: number;
}

export interface RateLimiterClock {
  readonly now: () => number;
}

interface Bucket {
  tokens: number;
  lastRefillMs: number;
  lastAccessMs: number;
}

/**
 * In-memory token bucket rate limiter keyed by site plus a hash of the
 * caller's IP address. The raw IP is never stored — only its hash — so the
 * limiter itself cannot become a place where identifying data leaks or
 * persists. Idle buckets are swept out on access so the map cannot grow
 * without bound under a sustained flood of distinct IPs.
 */
export class TokenBucketRateLimiter {
  readonly #capacity: number;
  readonly #refillPerMs: number;
  readonly #ttlMs: number;
  readonly #now: () => number;
  readonly #buckets = new Map<string, Bucket>();

  constructor(options: RateLimiterOptions = {}, clock: RateLimiterClock = { now: () => Date.now() }) {
    this.#capacity = options.capacity ?? DEFAULT_CAPACITY;
    this.#refillPerMs = (options.refillPerMinute ?? DEFAULT_REFILL_PER_MINUTE) / 60_000;
    this.#ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.#now = clock.now;
  }

  /** Attempts to spend one token for `site` + `ip`. Returns whether the request is allowed. */
  consume(site: string, ip: string): boolean {
    const now = this.#now();
    this.#sweep(now);

    const key = this.#keyFor(site, ip);
    const bucket = this.#buckets.get(key) ?? { tokens: this.#capacity, lastRefillMs: now, lastAccessMs: now };

    const elapsedMs = now - bucket.lastRefillMs;
    bucket.tokens = Math.min(this.#capacity, bucket.tokens + elapsedMs * this.#refillPerMs);
    bucket.lastRefillMs = now;
    bucket.lastAccessMs = now;

    let allowed = false;
    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      allowed = true;
    }

    this.#buckets.set(key, bucket);
    return allowed;
  }

  /** Number of tracked buckets. Exposed for tests and observability, not part of the rate-limiting contract. */
  size(): number {
    return this.#buckets.size;
  }

  /** Exposes the (hashed) bucket keys for tests, to prove no raw IP is ever stored. */
  debugKeys(): readonly string[] {
    return [...this.#buckets.keys()];
  }

  #keyFor(site: string, ip: string): string {
    const ipHash = createHash('sha256').update(ip).digest('hex');
    return `${site}:${ipHash}`;
  }

  #sweep(now: number): void {
    for (const [key, bucket] of this.#buckets) {
      if (now - bucket.lastAccessMs > this.#ttlMs) {
        this.#buckets.delete(key);
      }
    }
  }
}

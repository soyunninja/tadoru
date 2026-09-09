import type { Clock } from '../Clock.ts';

/**
 * Deterministic in-memory Clock fake for tests. Time only moves when the
 * test tells it to.
 */
export class FakeClock implements Clock {
  #current: Date;

  constructor(initial: Date) {
    this.#current = initial;
  }

  now(): Date {
    return this.#current;
  }

  setNow(next: Date): void {
    this.#current = next;
  }
}

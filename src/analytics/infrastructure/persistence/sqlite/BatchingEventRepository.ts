import type { EventRepository } from '../../../domain/ports/EventRepository.ts';
import type { TrackedEvent } from '../../../domain/event/TrackedEvent.ts';

const DEFAULT_MAX_BATCH_SIZE = 100;
const DEFAULT_FLUSH_INTERVAL_MS = 1000;

export interface BatchingEventRepositoryOptions {
  readonly maxBatchSize?: number;
  readonly flushIntervalMs?: number;
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * Decorator over an EventRepository that buffers writes in memory and
 * flushes on whichever comes first: `maxBatchSize` events or
 * `flushIntervalMs` milliseconds. `findLastEventForVisitor` must consult the
 * buffer BEFORE the delegate: an event that only lives in the buffer is
 * invisible to the underlying database, so skipping the buffer here would
 * make two page views inside the same flush window each look like the start
 * of a new session, inflating session counts.
 */
export class BatchingEventRepository implements EventRepository {
  readonly #delegate: EventRepository;
  readonly #maxBatchSize: number;
  readonly #flushIntervalMs: number;
  #buffer: TrackedEvent[] = [];
  #flushTimer: NodeJS.Timeout | undefined;

  constructor(delegate: EventRepository, options: BatchingEventRepositoryOptions = {}) {
    this.#delegate = delegate;
    this.#maxBatchSize = options.maxBatchSize ?? DEFAULT_MAX_BATCH_SIZE;
    this.#flushIntervalMs = options.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS;
  }

  saveBatch(events: readonly TrackedEvent[]): Promise<void> {
    this.#buffer.push(...events);
    this.#scheduleFlush();

    if (this.#buffer.length >= this.#maxBatchSize) {
      return this.flush();
    }
    return Promise.resolve();
  }

  findLastEventForVisitor(visitorId: Uint8Array): Promise<TrackedEvent | undefined> {
    for (let i = this.#buffer.length - 1; i >= 0; i -= 1) {
      const candidate = this.#buffer[i];
      if (candidate !== undefined && sameBytes(candidate.visitorId, visitorId)) {
        return Promise.resolve(candidate);
      }
    }
    return this.#delegate.findLastEventForVisitor(visitorId);
  }

  /** Drains whatever is buffered to the delegate. Call on shutdown. */
  async flush(): Promise<void> {
    this.#clearScheduledFlush();
    if (this.#buffer.length === 0) return;

    const toFlush = this.#buffer;
    this.#buffer = [];
    await this.#delegate.saveBatch(toFlush);
  }

  #scheduleFlush(): void {
    if (this.#flushTimer !== undefined) return;
    const timer = setTimeout(() => {
      this.#flushTimer = undefined;
      void this.flush();
    }, this.#flushIntervalMs);
    timer.unref?.();
    this.#flushTimer = timer;
  }

  #clearScheduledFlush(): void {
    if (this.#flushTimer !== undefined) {
      clearTimeout(this.#flushTimer);
      this.#flushTimer = undefined;
    }
  }
}

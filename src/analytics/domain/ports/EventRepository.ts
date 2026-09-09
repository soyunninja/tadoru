import type { TrackedEvent } from '../event/TrackedEvent.ts';

/**
 * Driven port for persisting tracked events. Writes are batched by the
 * application layer; `findLastEventForVisitor` backs session resolution.
 */
export interface EventRepository {
  saveBatch(events: readonly TrackedEvent[]): Promise<void>;
  findLastEventForVisitor(visitorId: Uint8Array): Promise<TrackedEvent | undefined>;
}

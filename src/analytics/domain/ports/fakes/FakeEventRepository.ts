import type { EventRepository } from '../EventRepository.ts';
import type { TrackedEvent } from '../../event/TrackedEvent.ts';

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * In-memory EventRepository fake. Keeps every saved event so tests can
 * inspect exactly what would have been persisted.
 */
export class FakeEventRepository implements EventRepository {
  readonly events: TrackedEvent[] = [];

  saveBatch(events: readonly TrackedEvent[]): Promise<void> {
    this.events.push(...events);
    return Promise.resolve();
  }

  findLastEventForVisitor(visitorId: Uint8Array): Promise<TrackedEvent | undefined> {
    let last: TrackedEvent | undefined;
    for (const event of this.events) {
      if (!sameBytes(event.visitorId, visitorId)) continue;
      if (last === undefined || event.ts > last.ts) {
        last = event;
      }
    }
    return Promise.resolve(last);
  }
}

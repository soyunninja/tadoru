import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EVENT_TYPES, isEventType } from './EventType.ts';

test('EVENT_TYPES lists every supported event kind', () => {
  assert.deepEqual(EVENT_TYPES, ['pageview', 'engagement', 'custom', 'outbound', 'vitals']);
});

test('isEventType accepts every listed event type', () => {
  for (const type of EVENT_TYPES) {
    assert.equal(isEventType(type), true);
  }
});

test('isEventType rejects unknown strings', () => {
  assert.equal(isEventType('click'), false);
  assert.equal(isEventType(''), false);
  assert.equal(isEventType('PAGEVIEW'), false);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { operatingSystemIcon } from './operatingSystem.ts';

// These are the exact family strings node-device-detector emits, confirmed by
// running it against real user agents rather than guessed.
test('covers every family the device detector actually produces', () => {
  assert.equal(operatingSystemIcon('iOS'), '🍎');
  assert.equal(operatingSystemIcon('Mac'), '🍎');
  assert.equal(operatingSystemIcon('Windows'), '🪟');
  assert.equal(operatingSystemIcon('Android'), '🤖');
  assert.equal(operatingSystemIcon('GNU/Linux'), '🐧');
  assert.equal(operatingSystemIcon('Chrome OS'), '🌐');
});

test('matches regardless of case or surrounding whitespace', () => {
  assert.equal(operatingSystemIcon('  windows  '), '🪟');
  assert.equal(operatingSystemIcon('ANDROID'), '🤖');
});

test('recognises a distribution name, not only the family', () => {
  // The detector reports "GNU/Linux" as the family but "Ubuntu" as the name,
  // and a future change could surface either.
  assert.equal(operatingSystemIcon('Ubuntu'), '🐧');
  assert.equal(operatingSystemIcon('Debian'), '🐧');
  assert.equal(operatingSystemIcon('iPadOS'), '🍎');
});

test('shows no icon rather than a wrong one for an unrecognised system', () => {
  for (const value of ['', '   ', 'unknown', 'Symbian', 'HarmonyOS']) {
    assert.equal(operatingSystemIcon(value), '', `expected no icon for ${JSON.stringify(value)}`);
  }
});

test('never throws', () => {
  assert.doesNotThrow(() => operatingSystemIcon(''));
});

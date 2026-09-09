import { test } from 'node:test';
import assert from 'node:assert/strict';
import { operatingSystemIcon } from './operatingSystem.ts';

// These are the exact family strings node-device-detector emits, confirmed by
// running it against real user agents rather than guessed.
test('covers every family the device detector actually produces', () => {
  assert.equal(operatingSystemIcon('iOS'), '\u{f179}');
  assert.equal(operatingSystemIcon('Mac'), '\u{f179}');
  assert.equal(operatingSystemIcon('Windows'), '\u{f17a}');
  assert.equal(operatingSystemIcon('Android'), '\u{f17b}');
  assert.equal(operatingSystemIcon('GNU/Linux'), '\u{f17c}');
  assert.equal(operatingSystemIcon('Chrome OS'), '\u{f268}');
});

test('matches regardless of case or surrounding whitespace', () => {
  assert.equal(operatingSystemIcon('  windows  '), '\u{f17a}');
  assert.equal(operatingSystemIcon('ANDROID'), '\u{f17b}');
});

test('recognises a distribution name, not only the family', () => {
  // The detector reports "GNU/Linux" as the family but "Ubuntu" as the name,
  // and a future change could surface either.
  assert.equal(operatingSystemIcon('Ubuntu'), '\u{f17c}');
  assert.equal(operatingSystemIcon('Debian'), '\u{f17c}');
  assert.equal(operatingSystemIcon('iPadOS'), '\u{f179}');
});

test('shows no icon rather than a wrong one for an unrecognised system', () => {
  for (const value of ['', '   ', 'unknown', 'Symbian', 'HarmonyOS']) {
    assert.equal(operatingSystemIcon(value), '', `expected no icon for ${JSON.stringify(value)}`);
  }
});

test('never throws', () => {
  assert.doesNotThrow(() => operatingSystemIcon(''));
});

test('every icon sits in the Font Awesome range the licence notice covers', () => {
  // Font Logos (U+F300 and above) is recorded as unlicensed in the Nerd Fonts
  // audit, so no glyph may come from there.
  for (const family of ['iOS', 'Mac', 'Windows', 'Android', 'GNU/Linux', 'Chrome OS']) {
    const codepoint = operatingSystemIcon(family).codePointAt(0);
    assert.ok(codepoint !== undefined && codepoint >= 0xf000 && codepoint <= 0xf2ff,
      `${family} uses U+${codepoint?.toString(16)}, outside the attributed range`);
  }
});

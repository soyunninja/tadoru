import { test } from 'node:test';
import assert from 'node:assert/strict';
import { browserIcon } from './browser.ts';

test('covers the families the device detector produces', () => {
  assert.equal(browserIcon('Chrome'), '\u{f268}');
  assert.equal(browserIcon('Firefox'), '\u{f269}');
  assert.equal(browserIcon('Safari'), '\u{f267}');
  assert.equal(browserIcon('Opera'), '\u{f26a}');
  // The detector groups Edge under the Internet Explorer family.
  assert.equal(browserIcon('Internet Explorer'), '\u{f26b}');
  assert.equal(browserIcon('Edge'), '\u{f282}');
});

test('matches regardless of case or whitespace', () => {
  assert.equal(browserIcon('  chrome '), '\u{f268}');
  assert.equal(browserIcon('FIREFOX'), '\u{f269}');
});

test('shows nothing rather than a wrong icon for an unknown client', () => {
  for (const value of ['', '  ', 'curl', 'unknown', 'Lynx']) {
    assert.equal(browserIcon(value), '', `expected no icon for ${JSON.stringify(value)}`);
  }
});

test('every icon sits in the Font Awesome range the licence notice covers', () => {
  for (const family of ['Chrome', 'Firefox', 'Safari', 'Opera', 'Edge', 'Internet Explorer']) {
    const codepoint = browserIcon(family).codePointAt(0);
    assert.ok(codepoint !== undefined && codepoint >= 0xf000 && codepoint <= 0xf2ff);
  }
});

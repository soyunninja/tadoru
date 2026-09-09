import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatNumber, formatPercent, formatIsoDate, formatDuration } from './format.ts';

test('formatNumber groups thousands per locale', () => {
  assert.equal(formatNumber(1234, 'en'), '1,234');
  assert.equal(formatNumber(1234, 'es'), '1.234');
  assert.equal(formatNumber(1234, 'ja'), '1,234');
});

test('formatNumber renders a small count with no grouping needed', () => {
  assert.equal(formatNumber(7, 'en'), '7');
  assert.equal(formatNumber(7, 'es'), '7');
  assert.equal(formatNumber(7, 'ja'), '7');
});

test('formatPercent uses a comma decimal separator in Spanish, a dot in English and Japanese', () => {
  assert.equal(formatPercent(0.352, 'en'), '35.2%');
  assert.equal(formatPercent(0.352, 'es'), '35,2%');
  assert.equal(formatPercent(0.352, 'ja'), '35.2%');
});

test('formatPercent always renders one decimal place', () => {
  assert.equal(formatPercent(0, 'en'), '0.0%');
  assert.equal(formatPercent(0.5, 'en'), '50.0%');
  assert.equal(formatPercent(1, 'en'), '100.0%');
});

test('formatIsoDate renders a locale-appropriate date', () => {
  assert.equal(formatIsoDate('2026-01-01', 'en'), 'Jan 1, 2026');
  assert.equal(formatIsoDate('2026-01-01', 'es'), '1 ene 2026');
  assert.equal(formatIsoDate('2026-01-01', 'ja'), '2026/01/01');
});

test('formatIsoDate is fixed to UTC, so a day boundary never shifts', () => {
  // Regardless of the host machine's own timezone, the 1st stays the 1st.
  assert.equal(formatIsoDate('2026-01-01', 'en'), 'Jan 1, 2026');
});

test('formatIsoDate never throws on malformed input, falling back to the raw string', () => {
  for (const bad of ['', 'not-a-date', '2026-13-99', '   ']) {
    assert.doesNotThrow(() => formatIsoDate(bad, 'en'));
  }
  assert.equal(formatIsoDate('not-a-date', 'en'), 'not-a-date');
});

test('formatDuration renders m:ss the same regardless of locale', () => {
  assert.equal(formatDuration(0), '0:00');
  assert.equal(formatDuration(5), '0:05');
  assert.equal(formatDuration(65), '1:05');
  assert.equal(formatDuration(600), '10:00');
});

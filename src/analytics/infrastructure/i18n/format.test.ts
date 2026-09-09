import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatNumber, formatPercent, formatIsoDate, formatDuration, formatRelativeTime } from './format.ts';

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

const NOW = 1_700_000_000;

test('formatRelativeTime renders seconds under a minute', () => {
  assert.equal(formatRelativeTime(NOW, NOW, 'en'), '0 seconds ago');
  assert.equal(formatRelativeTime(NOW - 30, NOW, 'en'), '30 seconds ago');
  assert.equal(formatRelativeTime(NOW - 59, NOW, 'en'), '59 seconds ago');
});

test('formatRelativeTime renders minutes once 60 seconds have passed', () => {
  assert.equal(formatRelativeTime(NOW - 60, NOW, 'en'), '1 minute ago');
  assert.equal(formatRelativeTime(NOW - 120, NOW, 'en'), '2 minutes ago');
  assert.equal(formatRelativeTime(NOW - 3_599, NOW, 'en'), '59 minutes ago');
});

test('formatRelativeTime renders hours once 60 minutes have passed', () => {
  assert.equal(formatRelativeTime(NOW - 3_600, NOW, 'en'), '1 hour ago');
  assert.equal(formatRelativeTime(NOW - 7_200, NOW, 'en'), '2 hours ago');
  assert.equal(formatRelativeTime(NOW - 86_399, NOW, 'en'), '23 hours ago');
});

test('formatRelativeTime renders days once 24 hours have passed', () => {
  assert.equal(formatRelativeTime(NOW - 86_400, NOW, 'en'), '1 day ago');
  assert.equal(formatRelativeTime(NOW - 172_800, NOW, 'en'), '2 days ago');
});

test('formatRelativeTime translates the unit per locale', () => {
  assert.equal(formatRelativeTime(NOW - 120, NOW, 'es'), 'hace 2 minutos');
  assert.equal(formatRelativeTime(NOW - 120, NOW, 'ja'), '2 分前');
});

test('formatRelativeTime clamps a future timestamp instead of rendering it as "in N seconds"', () => {
  assert.equal(formatRelativeTime(NOW + 500, NOW, 'en'), '0 seconds ago');
});

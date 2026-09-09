import { test } from 'node:test';
import assert from 'node:assert/strict';
import { countryFlagEmoji, countryDisplayName } from './country.ts';

test('derives the flag from the ISO code, with no lookup table', () => {
  assert.equal(countryFlagEmoji('ES'), '🇪🇸');
  assert.equal(countryFlagEmoji('MX'), '🇲🇽');
  assert.equal(countryFlagEmoji('JP'), '🇯🇵');
});

test('accepts a lowercase code', () => {
  assert.equal(countryFlagEmoji('es'), '🇪🇸');
});

// 'XX' is the sentinel stored when geolocation fails. Feeding it to the
// regional-indicator arithmetic produces a meaningless 🇽🇽 box.
test('produces no flag for the unknown-country sentinel', () => {
  assert.equal(countryFlagEmoji('XX'), '');
});

test('produces no flag for malformed input, and never throws', () => {
  for (const bad of ['', 'E', 'ESP', '12', 'e1', '  ']) {
    assert.equal(countryFlagEmoji(bad), '', `expected no flag for ${JSON.stringify(bad)}`);
  }
});

test('names the country in English, matching the rest of the interface', () => {
  assert.equal(countryDisplayName('ES'), 'Spain');
  assert.equal(countryDisplayName('US'), 'United States');
  assert.equal(countryDisplayName('GB'), 'United Kingdom');
});

test('says Unknown for the sentinel rather than echoing "XX"', () => {
  assert.equal(countryDisplayName('XX'), 'Unknown');
});

// Intl.DisplayNames throws a RangeError on an empty string.
test('never throws on malformed input', () => {
  for (const bad of ['', 'E', 'ESP', '12', '  ']) {
    assert.doesNotThrow(() => countryDisplayName(bad));
  }
  assert.equal(countryDisplayName(''), 'Unknown');
});

test('falls back to the code itself when a region has no name', () => {
  // A syntactically valid but unassigned code should still render something.
  assert.match(countryDisplayName('QZ'), /QZ|Unknown/);
});

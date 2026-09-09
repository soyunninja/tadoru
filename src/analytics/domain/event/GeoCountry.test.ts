import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGeoCountry, UNKNOWN_COUNTRY } from './GeoCountry.ts';

test('accepts a valid ISO-3166 alpha-2 code and uppercases it', () => {
  assert.equal(createGeoCountry('es'), 'ES');
  assert.equal(createGeoCountry('US'), 'US');
});

test('falls back to the unknown sentinel for anything invalid', () => {
  assert.equal(createGeoCountry(''), UNKNOWN_COUNTRY);
  assert.equal(createGeoCountry(null), UNKNOWN_COUNTRY);
  assert.equal(createGeoCountry(undefined), UNKNOWN_COUNTRY);
  assert.equal(createGeoCountry('USA'), UNKNOWN_COUNTRY);
  assert.equal(createGeoCountry('1A'), UNKNOWN_COUNTRY);
  assert.equal(createGeoCountry('E'), UNKNOWN_COUNTRY);
});

test('the unknown sentinel is exactly the string "XX"', () => {
  assert.equal(UNKNOWN_COUNTRY, 'XX');
});

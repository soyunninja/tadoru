import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GeoipLiteResolver } from './GeoipLiteResolver.ts';
import { UNKNOWN_COUNTRY } from '../../domain/event/GeoCountry.ts';

test('resolves a known public IP to its ISO-3166 alpha-2 country', () => {
  const resolver = new GeoipLiteResolver();
  assert.equal(resolver.resolve('8.8.8.8'), 'US');
});

test('resolves an unroutable/loopback address to the unknown country sentinel', () => {
  const resolver = new GeoipLiteResolver();
  assert.equal(resolver.resolve('127.0.0.1'), UNKNOWN_COUNTRY);
});

test('never returns anything finer than a country: no region, city or coordinates leak through', () => {
  const resolver = new GeoipLiteResolver();
  const country = resolver.resolve('8.8.8.8');
  assert.match(country, /^[A-Z]{2}$/);
});

test('falls back to the unknown country sentinel when the underlying lookup throws', () => {
  const resolver = new GeoipLiteResolver({
    lookup: () => {
      throw new Error('corrupt database');
    },
  });
  assert.equal(resolver.resolve('8.8.8.8'), UNKNOWN_COUNTRY);
});

test('falls back to the unknown country sentinel for an invalid IP', () => {
  const resolver = new GeoipLiteResolver();
  assert.equal(resolver.resolve('not-an-ip'), UNKNOWN_COUNTRY);
});

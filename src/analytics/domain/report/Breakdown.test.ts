import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BREAKDOWN_DIMENSIONS, isBreakdownDimension, createBreakdown, ROLLUP_TABLE_ALLOW_LIST } from './Breakdown.ts';

test('lists exactly the ten supported dimensions', () => {
  assert.deepEqual(BREAKDOWN_DIMENSIONS, [
    'path',
    'referrer',
    'country',
    'device',
    'browser',
    'os',
    'campaign',
    'screen',
    'language',
    'colorScheme',
  ]);
});

test('isBreakdownDimension accepts every listed dimension', () => {
  for (const dimension of BREAKDOWN_DIMENSIONS) {
    assert.equal(isBreakdownDimension(dimension), true);
  }
});

test('isBreakdownDimension rejects an arbitrary string', () => {
  assert.equal(isBreakdownDimension('DROP TABLE sites; --'), false);
  assert.equal(isBreakdownDimension('site_id'), false);
  assert.equal(isBreakdownDimension(''), false);
});

test('createBreakdown resolves a valid dimension to its rollup table and raw column', () => {
  const result = createBreakdown('path');
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error('unreachable');
  assert.equal(result.value.dimension, 'path');
  assert.equal(result.value.rollupTable, 'rollup_daily_path');
  assert.equal(result.value.rawColumn, 'path');
});

test('createBreakdown resolves the three signal-derived dimensions to their rollup tables and raw columns', () => {
  const screen = createBreakdown('screen');
  assert.equal(screen.ok, true);
  if (!screen.ok) throw new Error('unreachable');
  assert.equal(screen.value.rollupTable, 'rollup_daily_screen');
  assert.equal(screen.value.rawColumn, 'screen_bucket');

  const language = createBreakdown('language');
  assert.equal(language.ok, true);
  if (!language.ok) throw new Error('unreachable');
  assert.equal(language.value.rollupTable, 'rollup_daily_language');
  assert.equal(language.value.rawColumn, 'lang');

  const colorScheme = createBreakdown('colorScheme');
  assert.equal(colorScheme.ok, true);
  if (!colorScheme.ok) throw new Error('unreachable');
  assert.equal(colorScheme.value.rollupTable, 'rollup_daily_color_scheme');
  assert.equal(colorScheme.value.rawColumn, 'color_scheme');
});

test('every resolved rollup table name is one of the fixed allow-listed tables', () => {
  for (const dimension of BREAKDOWN_DIMENSIONS) {
    const result = createBreakdown(dimension);
    assert.equal(result.ok, true);
    if (!result.ok) throw new Error('unreachable');
    assert.ok(ROLLUP_TABLE_ALLOW_LIST.includes(result.value.rollupTable));
  }
});

test('an arbitrary string can never reach the SQL: createBreakdown rejects it outright', () => {
  const malicious = 'events; DROP TABLE events; --';
  const result = createBreakdown(malicious);
  assert.equal(result.ok, false);
});

test('rejects an unsupported dimension with an error result rather than throwing', () => {
  assert.doesNotThrow(() => createBreakdown('not-a-dimension'));
  assert.equal(createBreakdown('not-a-dimension').ok, false);
});

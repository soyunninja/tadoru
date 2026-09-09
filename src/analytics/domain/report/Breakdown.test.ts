import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BREAKDOWN_DIMENSIONS, isBreakdownDimension, createBreakdown, ROLLUP_TABLE_ALLOW_LIST } from './Breakdown.ts';

test('lists exactly the seven supported dimensions', () => {
  assert.deepEqual(BREAKDOWN_DIMENSIONS, [
    'path',
    'referrer',
    'country',
    'device',
    'browser',
    'os',
    'campaign',
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

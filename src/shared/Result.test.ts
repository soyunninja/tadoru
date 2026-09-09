import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ok, err } from './Result.ts';
import type { Result } from './Result.ts';

test('ok() builds a successful result carrying a value', () => {
  const result = ok(42);
  assert.equal(result.ok, true);
  assert.equal(result.value, 42);
});

test('err() builds a failed result carrying an error', () => {
  const result = err('boom');
  assert.equal(result.ok, false);
  assert.equal(result.error, 'boom');
});

test('Result narrows by the ok discriminant', () => {
  const results: Array<Result<number, string>> = [ok(1), err('nope')];
  const values: number[] = [];
  const errors: string[] = [];

  for (const result of results) {
    if (result.ok) {
      values.push(result.value);
    } else {
      errors.push(result.error);
    }
  }

  assert.deepEqual(values, [1]);
  assert.deepEqual(errors, ['nope']);
});

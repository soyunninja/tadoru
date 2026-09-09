import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RotateSalt } from './RotateSalt.ts';
import type { SaltRotator } from './RotateSalt.ts';

class FakeSaltRotator implements SaltRotator {
  rotated: string[] = [];

  rotate(newSalt: string): Promise<void> {
    this.rotated.push(newSalt);
    return Promise.resolve();
  }
}

test('generates a fresh salt and hands it to the rotator', async () => {
  const rotator = new FakeSaltRotator();
  const useCase = new RotateSalt({ saltRotator: rotator });

  const newSalt = await useCase.execute();

  assert.equal(rotator.rotated.length, 1);
  assert.equal(rotator.rotated[0], newSalt);
});

test('the generated salt is derived from 32 random bytes (64 hex characters)', async () => {
  const rotator = new FakeSaltRotator();
  const useCase = new RotateSalt({ saltRotator: rotator });

  const newSalt = await useCase.execute();

  assert.equal(newSalt.length, 64);
  assert.match(newSalt, /^[0-9a-f]{64}$/);
});

test('two consecutive rotations produce different salts', async () => {
  const rotator = new FakeSaltRotator();
  const useCase = new RotateSalt({ saltRotator: rotator });

  const first = await useCase.execute();
  const second = await useCase.execute();

  assert.notEqual(first, second);
});

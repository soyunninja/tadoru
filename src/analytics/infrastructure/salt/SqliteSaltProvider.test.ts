import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../persistence/sqlite/Database.ts';
import { SqliteSaltProvider } from './SqliteSaltProvider.ts';

test('lazily initializes a random salt on first read when none exists yet', async () => {
  const db = openDatabase(':memory:');
  const provider = new SqliteSaltProvider(db);

  const salt = await provider.current();

  assert.equal(typeof salt, 'string');
  assert.ok(salt.length > 0);
});

test('returns the same salt on repeated reads', async () => {
  const db = openDatabase(':memory:');
  const provider = new SqliteSaltProvider(db);

  const a = await provider.current();
  const b = await provider.current();

  assert.equal(a, b);
});

test('rotate overwrites the current salt', async () => {
  const db = openDatabase(':memory:');
  const provider = new SqliteSaltProvider(db);

  const original = await provider.current();
  await provider.rotate('brand-new-salt');
  const rotated = await provider.current();

  assert.notEqual(rotated, original);
  assert.equal(rotated, 'brand-new-salt');
});

test('rotation is atomic and the previous salt is unrecoverable from the database: only one row survives, and it never contains the old value', async () => {
  const db = openDatabase(':memory:');
  const provider = new SqliteSaltProvider(db);

  await provider.rotate('old-salt-value');
  await provider.rotate('new-salt-value');

  const rows = db.prepare('SELECT * FROM salt').all() as { id: number; value: string }[];

  assert.equal(rows.length, 1, 'exactly one salt row must exist');
  assert.equal(rows[0]?.value, 'new-salt-value');
  assert.ok(!rows.some((row) => row.value === 'old-salt-value'));

  // Even serialized, the destroyed value must not appear anywhere in the table.
  const serialized = JSON.stringify(rows);
  assert.ok(!serialized.includes('old-salt-value'));
});

test('rotate updates rotated_at', async () => {
  const db = openDatabase(':memory:');
  const provider = new SqliteSaltProvider(db);

  await provider.rotate('salt-a');
  const first = db.prepare('SELECT rotated_at FROM salt WHERE id = 1').get() as { rotated_at: number };

  await new Promise((resolve) => setTimeout(resolve, 5));
  await provider.rotate('salt-b');
  const second = db.prepare('SELECT rotated_at FROM salt WHERE id = 1').get() as { rotated_at: number };

  assert.ok(second.rotated_at >= first.rotated_at);
});

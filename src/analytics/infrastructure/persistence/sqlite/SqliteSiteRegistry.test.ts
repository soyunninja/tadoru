import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from './Database.ts';
import { SqliteSiteRegistry } from './SqliteSiteRegistry.ts';

test('assigns an integer id to a domain seen for the first time', () => {
  const db = openDatabase(':memory:');
  const registry = new SqliteSiteRegistry(db);

  const id = registry.idFor('example.com');

  assert.equal(typeof id, 'number');
  const row = db.prepare('SELECT domain FROM sites WHERE id = ?').get(id) as { domain: string };
  assert.equal(row.domain, 'example.com');
});

test('returns the same id for a domain already known', () => {
  const db = openDatabase(':memory:');
  const registry = new SqliteSiteRegistry(db);

  const first = registry.idFor('example.com');
  const second = registry.idFor('example.com');

  assert.equal(first, second);
  const count = (db.prepare('SELECT COUNT(*) AS n FROM sites').get() as { n: number }).n;
  assert.equal(count, 1);
});

test('assigns distinct ids to distinct domains', () => {
  const db = openDatabase(':memory:');
  const registry = new SqliteSiteRegistry(db);

  const a = registry.idFor('example.com');
  const b = registry.idFor('other.com');

  assert.notEqual(a, b);
});

test('domainFor resolves an id back to its domain', () => {
  const db = openDatabase(':memory:');
  const registry = new SqliteSiteRegistry(db);

  const id = registry.idFor('example.com');

  assert.equal(registry.domainFor(id), 'example.com');
});

test('existingIdFor returns undefined without creating a row for an unknown domain', () => {
  const db = openDatabase(':memory:');
  const registry = new SqliteSiteRegistry(db);

  assert.equal(registry.existingIdFor('unknown.com'), undefined);
  const count = (db.prepare('SELECT COUNT(*) AS n FROM sites').get() as { n: number }).n;
  assert.equal(count, 0);
});

test('existingIdFor returns the id for a domain already registered', () => {
  const db = openDatabase(':memory:');
  const registry = new SqliteSiteRegistry(db);

  const id = registry.idFor('example.com');

  assert.equal(registry.existingIdFor('example.com'), id);
});

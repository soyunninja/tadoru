import { test } from 'node:test';
import assert from 'node:assert/strict';
import DatabaseConstructor from 'better-sqlite3';
import type { Database as BetterSqlite3Database } from 'better-sqlite3';
import { applyMigrations, ROLLUP_TABLE_NAMES } from './index.ts';

function tableNames(db: BetterSqlite3Database): string[] {
  return db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all()
    .map((row) => (row as { name: string }).name);
}

test('creates every expected table', () => {
  const db = new DatabaseConstructor(':memory:');
  applyMigrations(db);

  const names = tableNames(db);
  assert.ok(names.includes('schema_migrations'));
  assert.ok(names.includes('sites'));
  assert.ok(names.includes('events'));
  assert.ok(names.includes('salt'));
  for (const rollupTable of ROLLUP_TABLE_NAMES) {
    assert.ok(names.includes(rollupTable), `missing ${rollupTable}`);
  }
});

test('records every applied migration version in schema_migrations', () => {
  const db = new DatabaseConstructor(':memory:');
  applyMigrations(db);

  const rows = db.prepare('SELECT version FROM schema_migrations ORDER BY version').all() as { version: number }[];
  assert.ok(rows.length > 0);
  assert.ok(rows.every((row) => typeof row.version === 'number'));
});

test('is idempotent: applying twice does not error or duplicate migration rows', () => {
  const db = new DatabaseConstructor(':memory:');
  applyMigrations(db);
  const firstRunCount = (db.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get() as { n: number }).n;

  applyMigrations(db);
  const secondRunCount = (db.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get() as { n: number }).n;

  assert.equal(secondRunCount, firstRunCount);
});

test('the salt table enforces a single row via its id check constraint', () => {
  const db = new DatabaseConstructor(':memory:');
  applyMigrations(db);

  db.prepare('INSERT INTO salt (id, value, rotated_at) VALUES (1, ?, ?)').run('salt-a', 1);
  assert.throws(() => {
    db.prepare('INSERT INTO salt (id, value, rotated_at) VALUES (2, ?, ?)').run('salt-b', 2);
  });
});

test('the sites table enforces unique domains', () => {
  const db = new DatabaseConstructor(':memory:');
  applyMigrations(db);

  db.prepare('INSERT INTO sites (domain, created_at) VALUES (?, ?)').run('example.com', 1);
  assert.throws(() => {
    db.prepare('INSERT INTO sites (domain, created_at) VALUES (?, ?)').run('example.com', 2);
  });
});

test('each rollup table is keyed by (day, site_id, dimension) and rejects duplicates', () => {
  const db = new DatabaseConstructor(':memory:');
  applyMigrations(db);

  db.prepare(
    'INSERT INTO rollup_daily_path (day, site_id, path, pageviews, visitors, sessions, bounces, engagement_seconds) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(1, 1, '/blog', 1, 1, 1, 0, 0);

  assert.throws(() => {
    db.prepare(
      'INSERT INTO rollup_daily_path (day, site_id, path, pageviews, visitors, sessions, bounces, engagement_seconds) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(1, 1, '/blog', 2, 2, 2, 0, 0);
  });
});

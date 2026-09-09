import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from './Database.ts';

test('opens a connection and applies pragmas', () => {
  const db = openDatabase(':memory:');
  try {
    assert.equal(db.pragma('synchronous', { simple: true }), 1); // NORMAL
    assert.equal(db.pragma('busy_timeout', { simple: true }), 5000);
    assert.equal(db.pragma('foreign_keys', { simple: true }), 1);
  } finally {
    db.close();
  }
});

test('applies migrations on open: the schema is ready to use immediately', () => {
  const db = openDatabase(':memory:');
  try {
    const names = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all()
      .map((row) => (row as { name: string }).name);
    assert.ok(names.includes('events'));
    assert.ok(names.includes('rollup_daily_path'));
  } finally {
    db.close();
  }
});

test('opening the same file-backed database twice does not fail (idempotent migrations)', () => {
  const path = `${process.env['TMPDIR'] ?? '/tmp'}/tadoru-database-test-${Date.now()}-${Math.random()}.db`;
  const first = openDatabase(path);
  first.close();

  const second = openDatabase(path);
  try {
    const row = second.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get() as { n: number };
    assert.ok(row.n > 0);
  } finally {
    second.close();
  }
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import DatabaseConstructor from 'better-sqlite3';
import { backupFileName, resolveBackupPath, runBackup } from './backup.ts';

function withTempDir<T>(fn: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'tadoru-backup-test-'));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('backupFileName encodes the date and time in a filesystem-safe way', () => {
  const name = backupFileName(new Date('2026-09-08T12:34:56.000Z'));
  assert.equal(name, 'tadoru-backup-2026-09-08T12-34-56.sqlite');
});

test('resolveBackupPath joins the data directory and the filename', () => {
  const path = resolveBackupPath('/var/lib/tadoru', 'tadoru-backup-2026-09-08T12-34-56.sqlite');
  assert.equal(path, join('/var/lib/tadoru', 'tadoru-backup-2026-09-08T12-34-56.sqlite'));
});

test('runBackup vacuums a real database into a dated file and reports path and size', () => {
  withTempDir((dir) => {
    const sourcePath = join(dir, 'tadoru.db');
    const db = new DatabaseConstructor(sourcePath);
    db.exec('CREATE TABLE events (id INTEGER PRIMARY KEY, payload TEXT)');
    const insert = db.prepare('INSERT INTO events (payload) VALUES (?)');
    for (let i = 0; i < 50; i += 1) {
      insert.run(`payload-${i}`);
    }
    db.close();

    const logs: string[] = [];
    const result = runBackup({
      sourcePath,
      dataDir: dir,
      now: () => new Date('2026-09-08T12:34:56.000Z'),
      log: (msg) => logs.push(msg),
    });

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.value.path, join(dir, 'tadoru-backup-2026-09-08T12-34-56.sqlite'));
    assert.ok(existsSync(result.value.path));
    assert.ok(result.value.byteSize > 0);
    assert.equal(statSync(result.value.path).size, result.value.byteSize);
    assert.ok(logs.some((line) => line.includes(result.value.path)));
  });
});

test('runBackup refuses to overwrite an existing backup file', () => {
  withTempDir((dir) => {
    const sourcePath = join(dir, 'tadoru.db');
    const db = new DatabaseConstructor(sourcePath);
    db.exec('CREATE TABLE events (id INTEGER PRIMARY KEY)');
    db.close();

    const now = () => new Date('2026-09-08T12:34:56.000Z');
    const first = runBackup({ sourcePath, dataDir: dir, now, log: () => {} });
    assert.equal(first.ok, true);

    const second = runBackup({ sourcePath, dataDir: dir, now, log: () => {} });
    assert.equal(second.ok, false);
    if (!second.ok) {
      assert.match(second.error, /already exists/i);
    }
  });
});

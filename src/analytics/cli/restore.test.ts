import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import DatabaseConstructor from 'better-sqlite3';
import { ok, err } from '../../shared/Result.ts';
import type { LoadedConfig } from '../infrastructure/config/loadConfig.ts';
import type { Config } from '../infrastructure/config/Config.ts';
import { createSiteId } from '../domain/event/SiteId.ts';
import type { SiteId } from '../domain/event/SiteId.ts';
import { preRestoreFileName, resolvePreRestorePath, runRestoreCommand, verifyTadoruDatabaseFile } from './restore.ts';
import type { RestorePorts } from './restore.ts';
import type { HealthBody } from './status.ts';

function withTempDir<T>(fn: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'tadoru-restore-test-'));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function withTempDirAsync<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), 'tadoru-restore-test-'));
  try {
    return await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function siteId(domain: string): SiteId {
  const result = createSiteId(domain);
  if (!result.ok) throw new Error(`invalid test site id: ${domain}`);
  return result.value;
}

function buildConfig(dataDir: string, overrides: Partial<Config> = {}): Config {
  return {
    host: '127.0.0.1',
    dataDir,
    sites: [siteId('example.com')],
    trustedProxy: false,
    retention: { rawEventMonths: 25 },
    session: { inactivityMinutes: 30, secret: 'test-secret' },
    admin: { passwordHash: 'hash', passwordSalt: 'salt' },
    ...overrides,
  };
}

function buildPorts(dataDir: string, overrides: Partial<RestorePorts> = {}): RestorePorts {
  return {
    loadConfig: () => ok<LoadedConfig, string>({ config: buildConfig(dataDir), warnings: [] }),
    probeHealth: async () => undefined,
    verifyTadoruDatabase: verifyTadoruDatabaseFile,
    now: () => new Date('2026-09-08T12:34:56.000Z'),
    log: () => {},
    ...overrides,
  };
}

/** A minimal but genuine Tadoru database: real SQLite file carrying the two tables the app checks for. */
function makeTadoruDbFile(path: string, marker: string): void {
  const db = new DatabaseConstructor(path);
  db.exec('CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER)');
  db.exec('CREATE TABLE events (id INTEGER PRIMARY KEY, marker TEXT)');
  db.prepare('INSERT INTO events (marker) VALUES (?)').run(marker);
  db.close();
}

function readMarker(path: string): string {
  const db = new DatabaseConstructor(path, { readonly: true });
  try {
    const row = db.prepare('SELECT marker FROM events LIMIT 1').get() as { marker: string } | undefined;
    return row?.marker ?? '';
  } finally {
    db.close();
  }
}

function healthBody(): HealthBody {
  return { status: 'ok', database: { reachable: true }, jobs: {} };
}

// ---------------------------------------------------------------------------
// preRestoreFileName / resolvePreRestorePath
// ---------------------------------------------------------------------------

test('preRestoreFileName encodes the date and time in a filesystem-safe way', () => {
  const name = preRestoreFileName(new Date('2026-09-08T12:34:56.000Z'));
  assert.equal(name, 'tadoru-pre-restore-2026-09-08T12-34-56.sqlite');
});

test('resolvePreRestorePath joins the data directory and the filename', () => {
  const path = resolvePreRestorePath('/var/lib/tadoru', 'tadoru-pre-restore-2026-09-08T12-34-56.sqlite');
  assert.equal(path, join('/var/lib/tadoru', 'tadoru-pre-restore-2026-09-08T12-34-56.sqlite'));
});

// ---------------------------------------------------------------------------
// verifyTadoruDatabaseFile
// ---------------------------------------------------------------------------

test('verifyTadoruDatabaseFile accepts a real SQLite file carrying the expected schema', () => {
  withTempDir((dir) => {
    const path = join(dir, 'good.sqlite');
    makeTadoruDbFile(path, 'hello');
    const result = verifyTadoruDatabaseFile(path);
    assert.equal(result.ok, true);
  });
});

test('verifyTadoruDatabaseFile refuses a file that is not a valid SQLite database', () => {
  withTempDir((dir) => {
    const path = join(dir, 'garbage.sqlite');
    writeFileSync(path, 'this is definitely not a sqlite database');
    const result = verifyTadoruDatabaseFile(path);
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, /not a valid sqlite/i);
  });
});

test('verifyTadoruDatabaseFile refuses valid SQLite missing the Tadoru schema', () => {
  withTempDir((dir) => {
    const path = join(dir, 'unrelated.sqlite');
    const db = new DatabaseConstructor(path);
    db.exec('CREATE TABLE unrelated_table (id INTEGER PRIMARY KEY)');
    db.close();
    const result = verifyTadoruDatabaseFile(path);
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, /schema_migrations|Tadoru database/i);
  });
});

// ---------------------------------------------------------------------------
// runRestoreCommand — guard order and refusals
// ---------------------------------------------------------------------------

test('refuses when a server answers on the probed port, without --force', async () => {
  await withTempDirAsync(async (dir) => {
    const backupPath = join(dir, 'backup.sqlite');
    // Deliberately never created: the server-running guard must fire first.
    const ports = buildPorts(dir, { probeHealth: async () => healthBody() });
    const result = await runRestoreCommand({ backupFilePath: backupPath, dryRun: false, force: false }, ports);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.match(result.error, /running/i);
      assert.match(result.error, /systemctl stop tadoru/);
    }
    assert.equal(existsSync(backupPath), false);
  });
});

test('refuses when the backup file does not exist', async () => {
  await withTempDirAsync(async (dir) => {
    const backupPath = join(dir, 'does-not-exist.sqlite');
    const ports = buildPorts(dir);
    const result = await runRestoreCommand({ backupFilePath: backupPath, dryRun: false, force: false }, ports);
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, /does not exist/i);
  });
});

test('refuses when the backup file exists but is not valid SQLite', async () => {
  await withTempDirAsync(async (dir) => {
    const backupPath = join(dir, 'garbage.sqlite');
    writeFileSync(backupPath, 'not a database');
    const ports = buildPorts(dir);
    const result = await runRestoreCommand({ backupFilePath: backupPath, dryRun: false, force: false }, ports);
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, /not a valid sqlite/i);
  });
});

test('refuses when the backup file is SQLite but missing the Tadoru schema', async () => {
  await withTempDirAsync(async (dir) => {
    const backupPath = join(dir, 'unrelated.sqlite');
    const db = new DatabaseConstructor(backupPath);
    db.exec('CREATE TABLE unrelated_table (id INTEGER PRIMARY KEY)');
    db.close();
    const ports = buildPorts(dir);
    const result = await runRestoreCommand({ backupFilePath: backupPath, dryRun: false, force: false }, ports);
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, /schema_migrations|Tadoru database/i);
  });
});

test('--force skips only the running-server probe — every other guard still runs', async () => {
  await withTempDirAsync(async (dir) => {
    const missingBackupPath = join(dir, 'does-not-exist.sqlite');
    const ports = buildPorts(dir, { probeHealth: async () => healthBody() });

    const missingFileResult = await runRestoreCommand(
      { backupFilePath: missingBackupPath, dryRun: false, force: true },
      ports,
    );
    assert.equal(missingFileResult.ok, false);
    if (!missingFileResult.ok) assert.match(missingFileResult.error, /does not exist/i);

    const garbagePath = join(dir, 'garbage.sqlite');
    writeFileSync(garbagePath, 'not a database');
    const garbageResult = await runRestoreCommand({ backupFilePath: garbagePath, dryRun: false, force: true }, ports);
    assert.equal(garbageResult.ok, false);
    if (!garbageResult.ok) assert.match(garbageResult.error, /not a valid sqlite/i);

    const wrongSchemaPath = join(dir, 'unrelated.sqlite');
    const db = new DatabaseConstructor(wrongSchemaPath);
    db.exec('CREATE TABLE unrelated_table (id INTEGER PRIMARY KEY)');
    db.close();
    const wrongSchemaResult = await runRestoreCommand(
      { backupFilePath: wrongSchemaPath, dryRun: false, force: true },
      ports,
    );
    assert.equal(wrongSchemaResult.ok, false);
    if (!wrongSchemaResult.ok) assert.match(wrongSchemaResult.error, /schema_migrations|Tadoru database/i);
  });
});

// ---------------------------------------------------------------------------
// runRestoreCommand — the real replace, in order
// ---------------------------------------------------------------------------

test('moves the current live database aside (dated) before replacing it', async () => {
  await withTempDirAsync(async (dir) => {
    const liveDbPath = join(dir, 'tadoru.db');
    makeTadoruDbFile(liveDbPath, 'OLD');

    const backupPath = join(dir, 'backup.sqlite');
    makeTadoruDbFile(backupPath, 'NEW');

    const ports = buildPorts(dir);
    const result = await runRestoreCommand({ backupFilePath: backupPath, dryRun: false, force: false }, ports);

    assert.equal(result.ok, true);
    if (!result.ok) return;

    const asidePath = result.value.previousDatabaseMovedTo;
    assert.notEqual(asidePath, undefined);
    assert.ok(asidePath !== undefined && existsSync(asidePath));
    assert.equal(asidePath !== undefined ? readMarker(asidePath) : undefined, 'OLD');

    assert.ok(existsSync(liveDbPath));
    assert.equal(readMarker(liveDbPath), 'NEW');
  });
});

test('removes WAL and SHM sidecar files next to the live database as part of the replace', async () => {
  await withTempDirAsync(async (dir) => {
    const liveDbPath = join(dir, 'tadoru.db');
    makeTadoruDbFile(liveDbPath, 'OLD');
    const walPath = `${liveDbPath}-wal`;
    const shmPath = `${liveDbPath}-shm`;
    writeFileSync(walPath, 'stale-wal');
    writeFileSync(shmPath, 'stale-shm');

    const backupPath = join(dir, 'backup.sqlite');
    makeTadoruDbFile(backupPath, 'NEW');

    const ports = buildPorts(dir);
    const result = await runRestoreCommand({ backupFilePath: backupPath, dryRun: false, force: false }, ports);

    assert.equal(result.ok, true);
    assert.equal(existsSync(walPath), false);
    assert.equal(existsSync(shmPath), false);
  });
});

test('handles restoring when there is no existing live database', async () => {
  await withTempDirAsync(async (dir) => {
    const liveDbPath = join(dir, 'tadoru.db');
    const backupPath = join(dir, 'backup.sqlite');
    makeTadoruDbFile(backupPath, 'NEW');

    const ports = buildPorts(dir);
    const result = await runRestoreCommand({ backupFilePath: backupPath, dryRun: false, force: false }, ports);

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.value.previousDatabaseMovedTo, undefined);
    assert.ok(existsSync(liveDbPath));
    assert.equal(readMarker(liveDbPath), 'NEW');
  });
});

// ---------------------------------------------------------------------------
// --dry-run
// ---------------------------------------------------------------------------

test('--dry-run performs zero filesystem effects and prints the plan', async () => {
  await withTempDirAsync(async (dir) => {
    const liveDbPath = join(dir, 'tadoru.db');
    makeTadoruDbFile(liveDbPath, 'OLD');
    const walPath = `${liveDbPath}-wal`;
    const shmPath = `${liveDbPath}-shm`;
    writeFileSync(walPath, 'stale-wal');
    writeFileSync(shmPath, 'stale-shm');
    const liveBytesBefore = readFileSync(liveDbPath);

    const backupPath = join(dir, 'backup.sqlite');
    makeTadoruDbFile(backupPath, 'NEW');

    const logs: string[] = [];
    const ports = buildPorts(dir, { log: (message) => logs.push(message) });
    const result = await runRestoreCommand({ backupFilePath: backupPath, dryRun: true, force: false }, ports);

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.value.dryRun, true);

    // Nothing on disk changed.
    assert.deepEqual(readFileSync(liveDbPath), liveBytesBefore);
    assert.equal(existsSync(walPath), true);
    assert.equal(existsSync(shmPath), true);
    assert.equal(readMarker(liveDbPath), 'OLD');

    // No dated aside file was created anywhere in the data directory.
    const asideCandidate = resolvePreRestorePath(dir, preRestoreFileName(new Date('2026-09-08T12:34:56.000Z')));
    assert.equal(existsSync(asideCandidate), false);

    assert.ok(logs.some((line) => /dry run|plan/i.test(line)));
  });
});

test('--dry-run still runs every guard (refuses on missing schema without touching anything)', async () => {
  await withTempDirAsync(async (dir) => {
    const liveDbPath = join(dir, 'tadoru.db');
    makeTadoruDbFile(liveDbPath, 'OLD');

    const backupPath = join(dir, 'unrelated.sqlite');
    const db = new DatabaseConstructor(backupPath);
    db.exec('CREATE TABLE unrelated_table (id INTEGER PRIMARY KEY)');
    db.close();

    const ports = buildPorts(dir);
    const result = await runRestoreCommand({ backupFilePath: backupPath, dryRun: true, force: false }, ports);

    assert.equal(result.ok, false);
    assert.equal(readMarker(liveDbPath), 'OLD');
  });
});

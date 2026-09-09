import { existsSync, renameSync, copyFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import DatabaseConstructor from 'better-sqlite3';
import type { Result } from '../../shared/Result.ts';
import { err, ok } from '../../shared/Result.ts';
import type { LoadConfigOptions, LoadedConfig } from '../infrastructure/config/loadConfig.ts';
import type { Config } from '../infrastructure/config/Config.ts';
import { candidatePorts } from '../infrastructure/http/bindPort.ts';
import { DATABASE_FILE_NAME, probeableHost } from './status.ts';
import type { ProbeHealthPort } from './status.ts';

/** Tables `verifyTadoruDatabaseFile` requires to be present before trusting a file as a Tadoru database. */
const REQUIRED_TABLE_NAMES = ['schema_migrations', 'events'] as const;

/** Formats a date as `tadoru-pre-restore-YYYY-MM-DDTHH-MM-SS.sqlite` — mirrors `backupFileName`. */
export function preRestoreFileName(date: Date): string {
  const iso = date.toISOString(); // e.g. 2026-09-08T12:34:56.000Z
  const withoutMillis = iso.slice(0, 19); // 2026-09-08T12:34:56
  const safe = withoutMillis.replaceAll(':', '-');
  return `tadoru-pre-restore-${safe}.sqlite`;
}

export function resolvePreRestorePath(dataDir: string, fileName: string): string {
  return join(dataDir, fileName);
}

export type VerifyTadoruDatabasePort = (path: string) => Result<void, string>;

/**
 * Opens `path` strictly read-only and checks it carries the tables this
 * application expects (`schema_migrations`, `events`) before `restore`
 * trusts it enough to overwrite the live database with it. Restoring an
 * unrelated `.db` file over a live installation because the path was
 * mistyped must be impossible, not merely unlikely.
 */
export function verifyTadoruDatabaseFile(path: string): Result<void, string> {
  let db: InstanceType<typeof DatabaseConstructor>;
  try {
    db = new DatabaseConstructor(path, { readonly: true, fileMustExist: true });
  } catch (error) {
    return err(`${path} is not a valid SQLite database: ${error instanceof Error ? error.message : String(error)}`);
  }

  try {
    const rows = db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (${REQUIRED_TABLE_NAMES.map(() => '?').join(', ')})`,
      )
      .all(...REQUIRED_TABLE_NAMES) as { name: string }[];
    const present = new Set(rows.map((row) => row.name));
    const missing = REQUIRED_TABLE_NAMES.filter((name) => !present.has(name));

    if (missing.length > 0) {
      return err(
        `${path} is a SQLite database, but it does not look like a Tadoru database — missing table(s): ` +
          `${missing.join(', ')}. Refusing to restore an unrelated database.`,
      );
    }

    return ok(undefined);
  } catch (error) {
    // A file that exists but is not really a SQLite database (or is one but
    // corrupt) opens fine and only fails once queried — reported the same
    // way as a constructor failure, from the operator's point of view both
    // mean "this is not a valid SQLite database".
    return err(`${path} is not a valid SQLite database: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    db.close();
  }
}


/** Probes every candidate port and returns the first one a server answered on, or `undefined` if none did. */
async function findRunningServerPort(config: Config, probeHealth: ProbeHealthPort): Promise<number | undefined> {
  const host = probeableHost(config.host);
  for (const port of candidatePorts(config.port)) {
    const body = await probeHealth(host, port);
    if (body !== undefined) return port;
  }
  return undefined;
}

export interface RestorePorts {
  readonly loadConfig: (options?: LoadConfigOptions) => Result<LoadedConfig, string>;
  readonly probeHealth: ProbeHealthPort;
  readonly verifyTadoruDatabase: VerifyTadoruDatabasePort;
  readonly now?: () => Date;
  readonly log: (message: string) => void;
}

export interface RunRestoreOptions {
  readonly backupFilePath: string;
  readonly dryRun: boolean;
  /** Skips ONLY the running-server probe. Every other guard still runs. */
  readonly force: boolean;
  readonly loadConfigOptions?: LoadConfigOptions;
}

export interface RestoreOutcome {
  readonly restoredFrom: string;
  readonly liveDatabasePath: string;
  /** Where the previously-live database was moved, or `undefined` when there was none to move. */
  readonly previousDatabaseMovedTo: string | undefined;
  readonly dryRun: boolean;
}

/**
 * `tadoru restore <backup-file>`: replaces the live database with a backup,
 * safely. In order: refuses while the server is running (unless --force),
 * verifies the file is actually a Tadoru database, moves the current
 * database aside to a dated file, then replaces it — removing stale
 * `-wal`/`-shm` sidecars so a restored database never starts from an
 * inconsistent journal. `--dry-run` runs every guard for real but performs
 * no filesystem effect, only reporting the plan.
 */
export async function runRestoreCommand(options: RunRestoreOptions, ports: RestorePorts): Promise<Result<RestoreOutcome, string>> {
  const loaded = ports.loadConfig(options.loadConfigOptions);
  if (!loaded.ok) return err(loaded.error);
  const config = loaded.value.config;

  if (!options.force) {
    const runningPort = await findRunningServerPort(config, ports.probeHealth);
    if (runningPort !== undefined) {
      return err(
        `Tadoru appears to be running (a server answered on port ${runningPort}). Stop it first — ` +
          'e.g. "sudo systemctl stop tadoru" if it runs as a systemd service, or Ctrl-C the "tadoru start" ' +
          'process — then run restore again. Pass --force to skip only this check if you understand the ' +
          'risk: restoring into a live installation can corrupt the database the server is actively writing to.',
      );
    }
  }

  if (!existsSync(options.backupFilePath)) {
    return err(`Backup file ${options.backupFilePath} does not exist.`);
  }

  const verified = ports.verifyTadoruDatabase(options.backupFilePath);
  if (!verified.ok) return err(verified.error);

  const liveDatabasePath = join(config.dataDir, DATABASE_FILE_NAME);
  const walPath = `${liveDatabasePath}-wal`;
  const shmPath = `${liveDatabasePath}-shm`;
  const liveDatabaseExists = existsSync(liveDatabasePath);

  const now = ports.now ?? (() => new Date());
  const asidePath = resolvePreRestorePath(config.dataDir, preRestoreFileName(now()));

  if (options.dryRun) {
    ports.log('Dry run — no files will be changed. Plan:');
    ports.log(
      liveDatabaseExists
        ? `  1. Move current database ${liveDatabasePath} to ${asidePath}`
        : `  1. No current database found at ${liveDatabasePath}; nothing to move aside`,
    );
    ports.log(`  2. Remove ${walPath} and ${shmPath} if present`);
    ports.log(`  3. Copy ${options.backupFilePath} to ${liveDatabasePath}`);
    return ok({
      restoredFrom: options.backupFilePath,
      liveDatabasePath,
      previousDatabaseMovedTo: liveDatabaseExists ? asidePath : undefined,
      dryRun: true,
    });
  }

  let previousDatabaseMovedTo: string | undefined;
  if (liveDatabaseExists) {
    renameSync(liveDatabasePath, asidePath);
    previousDatabaseMovedTo = asidePath;
    ports.log(`Existing database moved to ${asidePath}`);
  } else {
    ports.log(`No existing database found at ${liveDatabasePath}; nothing to move aside.`);
  }

  for (const sidecarPath of [walPath, shmPath]) {
    if (existsSync(sidecarPath)) {
      unlinkSync(sidecarPath);
      ports.log(`Removed stale ${sidecarPath}`);
    }
  }

  copyFileSync(options.backupFilePath, liveDatabasePath);
  ports.log(`Restored ${options.backupFilePath} to ${liveDatabasePath}`);

  return ok({
    restoredFrom: options.backupFilePath,
    liveDatabasePath,
    previousDatabaseMovedTo,
    dryRun: false,
  });
}

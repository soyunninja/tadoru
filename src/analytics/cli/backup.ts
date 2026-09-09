import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import DatabaseConstructor from 'better-sqlite3';
import type { Result } from '../../shared/Result.ts';
import { err, ok } from '../../shared/Result.ts';

/** Formats a date as `tadoru-backup-YYYY-MM-DDTHH-MM-SS.sqlite` — sortable and safe on every filesystem. */
export function backupFileName(date: Date): string {
  const iso = date.toISOString(); // e.g. 2026-09-08T12:34:56.000Z
  const withoutMillis = iso.slice(0, 19); // 2026-09-08T12:34:56
  const safe = withoutMillis.replaceAll(':', '-');
  return `tadoru-backup-${safe}.sqlite`;
}

export function resolveBackupPath(dataDir: string, fileName: string): string {
  return join(dataDir, fileName);
}

export interface BackupResult {
  readonly path: string;
  readonly byteSize: number;
}

export interface RunBackupOptions {
  readonly sourcePath: string;
  readonly dataDir: string;
  readonly now?: () => Date;
  readonly log: (message: string) => void;
}

/**
 * `tadoru backup`: uses SQLite's `VACUUM INTO` to produce a single,
 * consistent snapshot file inside the data directory — restoring is just
 * copying it back over `tadoru.db`. Refuses to overwrite an existing file
 * with the same (dated) name rather than silently clobbering a previous
 * backup.
 */
export function runBackup(options: RunBackupOptions): Result<BackupResult, string> {
  const now = options.now ?? (() => new Date());
  const fileName = backupFileName(now());
  const destinationPath = resolveBackupPath(options.dataDir, fileName);

  if (existsSync(destinationPath)) {
    return err(`Backup destination ${destinationPath} already exists. Refusing to overwrite it.`);
  }

  const db = new DatabaseConstructor(options.sourcePath, { readonly: true });
  try {
    db.prepare('VACUUM INTO ?').run(destinationPath);
  } finally {
    db.close();
  }

  const byteSize = statSync(destinationPath).size;
  options.log(`Backup written to ${destinationPath} (${byteSize} bytes)`);

  return ok({ path: destinationPath, byteSize });
}

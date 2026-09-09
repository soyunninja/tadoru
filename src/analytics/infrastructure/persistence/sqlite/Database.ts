import DatabaseConstructor from 'better-sqlite3';
import type { Database as BetterSqlite3Database } from 'better-sqlite3';
import { applyMigrations } from './migrations/index.ts';

/**
 * Opens a SQLite connection with the pragmas this product needs — WAL for
 * concurrent readers during batched writes, NORMAL synchronous (safe under
 * WAL), a busy timeout so concurrent writers back off instead of failing
 * immediately, and enforced foreign keys — then applies any pending
 * migrations before handing the connection back.
 */
export function openDatabase(path: string): BetterSqlite3Database {
  const db = new DatabaseConstructor(path);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('busy_timeout = 5000');
  db.pragma('foreign_keys = ON');

  applyMigrations(db);

  return db;
}

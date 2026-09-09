import { randomBytes } from 'node:crypto';
import type { Database as BetterSqlite3Database, Statement } from 'better-sqlite3';
import type { SaltProvider } from '../../domain/ports/SaltProvider.ts';
import type { SaltRotator } from '../../application/RotateSalt.ts';

const INITIAL_SALT_BYTE_LENGTH = 32;

interface SaltRow {
  readonly value: string;
}

/**
 * SQLite adapter for the current daily-rotating salt. Only ever stores one
 * row (enforced by the `salt.id = 1` check constraint): rotating overwrites
 * it in a single UPDATE, so the write is atomic and the previous value
 * leaves no trace in the table.
 */
export class SqliteSaltProvider implements SaltProvider, SaltRotator {
  readonly #selectCurrent: Statement<[], SaltRow>;
  readonly #upsert: Statement<[string, number]>;

  constructor(db: BetterSqlite3Database) {
    this.#selectCurrent = db.prepare('SELECT value FROM salt WHERE id = 1');
    this.#upsert = db.prepare(`
      INSERT INTO salt (id, value, rotated_at) VALUES (1, ?, ?)
      ON CONFLICT(id) DO UPDATE SET value = excluded.value, rotated_at = excluded.rotated_at
    `);
  }

  current(): Promise<string> {
    const row = this.#selectCurrent.get();
    if (row !== undefined) {
      return Promise.resolve(row.value);
    }

    // No salt has ever been written: initialize one lazily so callers never
    // have to special-case "not yet rotated".
    const initial = randomBytes(INITIAL_SALT_BYTE_LENGTH).toString('hex');
    this.#upsert.run(initial, Date.now());
    return Promise.resolve(initial);
  }

  rotate(newSalt: string): Promise<void> {
    this.#upsert.run(newSalt, Date.now());
    return Promise.resolve();
  }
}

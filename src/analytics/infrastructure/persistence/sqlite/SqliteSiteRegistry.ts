import type { Database as BetterSqlite3Database, Statement } from 'better-sqlite3';

interface SiteRow {
  readonly id: number;
}

interface DomainRow {
  readonly domain: string;
}

/**
 * Maps a site domain to a small integer id, creating it on first sight.
 * Keeps the raw `events` table narrow (an integer FK instead of a repeated
 * domain string on every row).
 */
export class SqliteSiteRegistry {
  readonly #selectByDomain: Statement<[string], SiteRow>;
  readonly #selectDomainById: Statement<[number], DomainRow>;
  readonly #insert: Statement<[string, number]>;

  constructor(db: BetterSqlite3Database) {
    this.#selectByDomain = db.prepare('SELECT id FROM sites WHERE domain = ?');
    this.#selectDomainById = db.prepare('SELECT domain FROM sites WHERE id = ?');
    this.#insert = db.prepare('INSERT INTO sites (domain, created_at) VALUES (?, ?)');
  }

  idFor(domain: string): number {
    const existing = this.#selectByDomain.get(domain);
    if (existing !== undefined) return existing.id;

    const result = this.#insert.run(domain, Date.now());
    return Number(result.lastInsertRowid);
  }

  domainFor(id: number): string | undefined {
    return this.#selectDomainById.get(id)?.domain;
  }

  /** Read-only lookup: never creates a row for a domain not yet seen. */
  existingIdFor(domain: string): number | undefined {
    return this.#selectByDomain.get(domain)?.id;
  }
}

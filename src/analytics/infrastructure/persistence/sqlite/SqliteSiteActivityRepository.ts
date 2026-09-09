import type { Database as BetterSqlite3Database, Statement } from 'better-sqlite3';
import type { SiteActivityRepository, SiteActivity } from '../../../domain/ports/SiteActivityRepository.ts';
import type { SiteId } from '../../../domain/event/SiteId.ts';
import type { SqliteSiteRegistry } from './SqliteSiteRegistry.ts';

interface ActivityRow {
  readonly total: number;
  readonly last_ts: number | null;
}

/**
 * SQLite adapter for `SiteActivityRepository`. A single aggregate query
 * against the raw `events` table: no range, no breakdown, just "has
 * anything ever arrived and when was the last one".
 */
export class SqliteSiteActivityRepository implements SiteActivityRepository {
  readonly #selectActivity: Statement<[number], ActivityRow>;
  readonly #siteRegistry: SqliteSiteRegistry;

  constructor(db: BetterSqlite3Database, siteRegistry: SqliteSiteRegistry) {
    this.#selectActivity = db.prepare('SELECT COUNT(*) AS total, MAX(ts) AS last_ts FROM events WHERE site_id = ?');
    this.#siteRegistry = siteRegistry;
  }

  activityFor(site: SiteId): Promise<SiteActivity> {
    const siteRowId = this.#siteRegistry.existingIdFor(site);
    if (siteRowId === undefined) return Promise.resolve({ totalEvents: 0, lastEventTs: null });

    const row = this.#selectActivity.get(siteRowId);
    if (row === undefined || row.total === 0) return Promise.resolve({ totalEvents: 0, lastEventTs: null });

    return Promise.resolve({ totalEvents: row.total, lastEventTs: row.last_ts });
  }
}

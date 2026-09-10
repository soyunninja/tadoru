import type { Database as BetterSqlite3Database } from 'better-sqlite3';
import type { ScrollDepthRepository } from '../../../domain/ports/ScrollDepthRepository.ts';
import type { SiteId } from '../../../domain/event/SiteId.ts';
import type { TimeRange } from '../../../domain/report/TimeRange.ts';
import type { ScrollDepthAggregate } from '../../../domain/report/ScrollDepth.ts';
import type { SqliteSiteRegistry } from './SqliteSiteRegistry.ts';

interface ScrollRollupRow {
  readonly path: string;
  readonly depth_sum: number;
  readonly session_count: number;
}

/**
 * SQLite adapter for `ScrollDepthRepository`. Mirrors `SqliteMetricsRepository`:
 * `queryRollup` reads the precomputed `rollup_daily_scroll` table (see
 * `SqliteRollupBuilder`), `queryRaw` computes the same per-session-maximum
 * aggregate directly from raw `events` for the still-open current day.
 */
export class SqliteScrollDepthRepository implements ScrollDepthRepository {
  readonly #db: BetterSqlite3Database;
  readonly #siteRegistry: SqliteSiteRegistry;

  constructor(db: BetterSqlite3Database, siteRegistry: SqliteSiteRegistry) {
    this.#db = db;
    this.#siteRegistry = siteRegistry;
  }

  queryRollup(site: SiteId, range: TimeRange): Promise<readonly ScrollDepthAggregate[]> {
    const siteRowId = this.#siteRegistry.existingIdFor(site);
    if (siteRowId === undefined) return Promise.resolve([]);

    const rows = this.#db
      .prepare(
        `
        SELECT
          path AS path,
          SUM(depth_sum) AS depth_sum,
          SUM(session_count) AS session_count
        FROM rollup_daily_scroll
        WHERE site_id = @siteRowId AND day >= @start AND day < @end
        GROUP BY path
        `,
      )
      .all({ siteRowId, start: range.startTs, end: range.endTs }) as ScrollRollupRow[];

    return Promise.resolve(rows.map(toScrollDepthAggregate));
  }

  queryRaw(site: SiteId, range: TimeRange): Promise<readonly ScrollDepthAggregate[]> {
    const siteRowId = this.#siteRegistry.existingIdFor(site);
    if (siteRowId === undefined) return Promise.resolve([]);

    const rows = this.#db
      .prepare(
        `
        WITH session_max AS (
          SELECT session_id, path, MAX(value) AS max_depth
          FROM events
          WHERE site_id = @siteRowId AND ts >= @start AND ts < @end AND type = 'custom' AND name = 'scroll'
          GROUP BY session_id, path
        )
        SELECT
          path AS path,
          SUM(max_depth) AS depth_sum,
          COUNT(*) AS session_count
        FROM session_max
        GROUP BY path
        `,
      )
      .all({ siteRowId, start: range.startTs, end: range.endTs }) as ScrollRollupRow[];

    return Promise.resolve(rows.map(toScrollDepthAggregate));
  }
}

function toScrollDepthAggregate(row: ScrollRollupRow): ScrollDepthAggregate {
  return {
    path: row.path,
    depthSum: row.depth_sum,
    sessionsWithData: row.session_count,
  };
}

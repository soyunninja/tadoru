import type { Database as BetterSqlite3Database } from 'better-sqlite3';

const SECONDS_PER_DAY = 86_400;

interface DimensionSpec {
  readonly table: string;
  readonly column: string;
  readonly rawColumn: string;
}

/**
 * One rollup table per dimension. This is the whole point of the schema:
 * unique visitors are NOT additive across dimensions (a visitor who views
 * two paths is one unique per country but two uniques summed across paths),
 * so each table's `visitors` count is computed with its own independent
 * `COUNT(DISTINCT visitor_id)` straight from the raw `events` table — never
 * derived by summing or joining another rollup table.
 */
const DIMENSIONS: readonly DimensionSpec[] = [
  { table: 'rollup_daily_path', column: 'path', rawColumn: 'path' },
  { table: 'rollup_daily_referrer', column: 'referrer', rawColumn: 'referrer_source' },
  { table: 'rollup_daily_country', column: 'country', rawColumn: 'country' },
  { table: 'rollup_daily_device', column: 'device', rawColumn: 'device_type' },
  { table: 'rollup_daily_browser', column: 'browser', rawColumn: 'browser' },
  { table: 'rollup_daily_os', column: 'os', rawColumn: 'os' },
  { table: 'rollup_daily_campaign', column: 'campaign', rawColumn: 'utm_campaign' },
];

interface AggregatedRow {
  readonly site_id: number;
  readonly dimension_value: string;
  readonly pageviews: number;
  readonly visitors: number;
  readonly sessions: number;
  readonly engagement_seconds: number;
  readonly bounces: number;
}

/**
 * Nightly rollup rebuild: recomputes every rollup table for one full UTC day.
 * Re-running for the same day is idempotent — each dimension table's rows
 * for that day are replaced, never duplicated or added to.
 */
export class SqliteRollupBuilder {
  readonly #db: BetterSqlite3Database;

  constructor(db: BetterSqlite3Database) {
    this.#db = db;
  }

  execute(day: number): Promise<void> {
    const dayEnd = day + SECONDS_PER_DAY;

    const rebuildAll = this.#db.transaction(() => {
      for (const dimension of DIMENSIONS) {
        this.#rebuildDimension(dimension, day, dayEnd);
      }
    });
    rebuildAll();

    return Promise.resolve();
  }

  #rebuildDimension(dimension: DimensionSpec, day: number, dayEnd: number): void {
    this.#db.prepare(`DELETE FROM ${dimension.table} WHERE day = ?`).run(day);

    const rows = this.#db
      .prepare(
        `
        WITH session_pageview_counts AS (
          SELECT site_id, session_id, COUNT(*) AS pv_count
          FROM events
          WHERE ts >= @start AND ts < @end AND type = 'pageview'
          GROUP BY site_id, session_id
        ),
        bounce_sessions AS (
          SELECT site_id, session_id FROM session_pageview_counts WHERE pv_count = 1
        ),
        dimension_agg AS (
          SELECT
            site_id,
            COALESCE(${dimension.rawColumn}, '') AS dimension_value,
            SUM(CASE WHEN type = 'pageview' THEN 1 ELSE 0 END) AS pageviews,
            COUNT(DISTINCT visitor_id) AS visitors,
            COUNT(DISTINCT session_id) AS sessions,
            SUM(CASE WHEN type = 'engagement' THEN value ELSE 0 END) AS engagement_seconds
          FROM events
          WHERE ts >= @start AND ts < @end
          GROUP BY site_id, dimension_value
        ),
        bounce_agg AS (
          SELECT e.site_id, COALESCE(e.${dimension.rawColumn}, '') AS dimension_value, COUNT(*) AS bounces
          FROM events e
          JOIN bounce_sessions bs ON bs.site_id = e.site_id AND bs.session_id = e.session_id
          WHERE e.ts >= @start AND e.ts < @end AND e.type = 'pageview'
          GROUP BY e.site_id, dimension_value
        )
        SELECT
          da.site_id AS site_id,
          da.dimension_value AS dimension_value,
          da.pageviews AS pageviews,
          da.visitors AS visitors,
          da.sessions AS sessions,
          da.engagement_seconds AS engagement_seconds,
          COALESCE(ba.bounces, 0) AS bounces
        FROM dimension_agg da
        LEFT JOIN bounce_agg ba ON ba.site_id = da.site_id AND ba.dimension_value = da.dimension_value
        `,
      )
      .all({ start: day, end: dayEnd }) as AggregatedRow[];

    if (rows.length === 0) return;

    const insert = this.#db.prepare(`
      INSERT INTO ${dimension.table} (day, site_id, ${dimension.column}, pageviews, visitors, sessions, bounces, engagement_seconds)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const row of rows) {
      insert.run(
        day,
        row.site_id,
        row.dimension_value,
        row.pageviews,
        row.visitors,
        row.sessions,
        row.bounces,
        row.engagement_seconds,
      );
    }
  }
}

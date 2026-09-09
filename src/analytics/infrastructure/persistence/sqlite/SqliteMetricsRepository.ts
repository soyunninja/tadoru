import type { Database as BetterSqlite3Database } from 'better-sqlite3';
import type { MetricsRepository } from '../../../domain/ports/MetricsRepository.ts';
import type { SiteId } from '../../../domain/event/SiteId.ts';
import type { TimeRange } from '../../../domain/report/TimeRange.ts';
import type { Breakdown } from '../../../domain/report/Breakdown.ts';
import type { MetricRow } from '../../../domain/report/Metrics.ts';
import { SqliteSiteRegistry } from './SqliteSiteRegistry.ts';

interface RollupRow {
  readonly key: string;
  readonly pageviews: number;
  readonly visitors: number;
  readonly sessions: number;
  readonly bounces: number;
  readonly engagement_seconds: number;
}

/**
 * SQLite adapter for MetricsRepository. `queryRollup` and `queryRaw` are
 * built exclusively from a validated `Breakdown`, whose table and column
 * names come from a fixed allow-list (see domain/report/Breakdown.ts) — an
 * arbitrary string can never reach this SQL because there is no code path
 * that accepts one directly.
 */
export class SqliteMetricsRepository implements MetricsRepository {
  readonly #db: BetterSqlite3Database;
  readonly #siteRegistry: SqliteSiteRegistry;

  constructor(db: BetterSqlite3Database, siteRegistry: SqliteSiteRegistry) {
    this.#db = db;
    this.#siteRegistry = siteRegistry;
  }

  queryRollup(site: SiteId, range: TimeRange, breakdown: Breakdown): Promise<readonly MetricRow[]> {
    const siteRowId = this.#siteRegistry.existingIdFor(site);
    if (siteRowId === undefined) return Promise.resolve([]);

    const rows = this.#db
      .prepare(
        `
        SELECT
          ${breakdown.rollupColumn} AS key,
          SUM(pageviews) AS pageviews,
          SUM(visitors) AS visitors,
          SUM(sessions) AS sessions,
          SUM(bounces) AS bounces,
          SUM(engagement_seconds) AS engagement_seconds
        FROM ${breakdown.rollupTable}
        WHERE site_id = @siteRowId AND day >= @start AND day < @end
        GROUP BY ${breakdown.rollupColumn}
        `,
      )
      .all({ siteRowId, start: range.startTs, end: range.endTs }) as RollupRow[];

    return Promise.resolve(rows.map(toMetricRow));
  }

  queryRaw(site: SiteId, range: TimeRange, breakdown: Breakdown): Promise<readonly MetricRow[]> {
    const siteRowId = this.#siteRegistry.existingIdFor(site);
    if (siteRowId === undefined) return Promise.resolve([]);

    const rows = this.#db
      .prepare(
        `
        WITH session_pageview_counts AS (
          SELECT session_id, COUNT(*) AS pv_count
          FROM events
          WHERE site_id = @siteRowId AND ts >= @start AND ts < @end AND type = 'pageview'
          GROUP BY session_id
        ),
        bounce_sessions AS (
          SELECT session_id FROM session_pageview_counts WHERE pv_count = 1
        ),
        dimension_agg AS (
          SELECT
            COALESCE(${breakdown.rawColumn}, '') AS key,
            SUM(CASE WHEN type = 'pageview' THEN 1 ELSE 0 END) AS pageviews,
            COUNT(DISTINCT visitor_id) AS visitors,
            COUNT(DISTINCT session_id) AS sessions,
            SUM(CASE WHEN type = 'engagement' THEN value ELSE 0 END) AS engagement_seconds
          FROM events
          WHERE site_id = @siteRowId AND ts >= @start AND ts < @end
          GROUP BY key
        ),
        bounce_agg AS (
          SELECT COALESCE(e.${breakdown.rawColumn}, '') AS key, COUNT(*) AS bounces
          FROM events e
          JOIN bounce_sessions bs ON bs.session_id = e.session_id
          WHERE e.site_id = @siteRowId AND e.ts >= @start AND e.ts < @end AND e.type = 'pageview'
          GROUP BY key
        )
        SELECT
          da.key AS key,
          da.pageviews AS pageviews,
          da.visitors AS visitors,
          da.sessions AS sessions,
          COALESCE(ba.bounces, 0) AS bounces,
          da.engagement_seconds AS engagement_seconds
        FROM dimension_agg da
        LEFT JOIN bounce_agg ba ON ba.key = da.key
        `,
      )
      .all({ siteRowId, start: range.startTs, end: range.endTs }) as RollupRow[];

    return Promise.resolve(rows.map(toMetricRow));
  }
}

function toMetricRow(row: RollupRow): MetricRow {
  return {
    key: row.key,
    pageviews: row.pageviews,
    visitors: row.visitors,
    sessions: row.sessions,
    bounces: row.bounces,
    engagementSeconds: row.engagement_seconds,
  };
}

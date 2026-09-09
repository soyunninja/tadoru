/**
 * One row of aggregated metrics for a single breakdown key (a path, a
 * country, a referrer source...). `visitors` is always an exact distinct
 * count computed independently per dimension — see SqliteRollupBuilder — and
 * is therefore safe to sum across days, but never across dimensions.
 */
export interface MetricRow {
  readonly key: string;
  readonly pageviews: number;
  readonly visitors: number;
  readonly sessions: number;
  readonly bounces: number;
  readonly engagementSeconds: number;
}

export function emptyMetricRow(key: string): MetricRow {
  return { key, pageviews: 0, visitors: 0, sessions: 0, bounces: 0, engagementSeconds: 0 };
}

function addMetricRow(a: MetricRow, b: MetricRow): MetricRow {
  return {
    key: a.key,
    pageviews: a.pageviews + b.pageviews,
    visitors: a.visitors + b.visitors,
    sessions: a.sessions + b.sessions,
    bounces: a.bounces + b.bounces,
    engagementSeconds: a.engagementSeconds + b.engagementSeconds,
  };
}

/**
 * Combines rows from multiple sources (e.g. closed-day rollups plus today's
 * raw aggregate) into one row per key by summing counters. Each input row
 * must already be a per-day exact count, so summing across days is sound.
 */
export function mergeMetricRowsByKey(rows: readonly MetricRow[]): MetricRow[] {
  const merged = new Map<string, MetricRow>();
  for (const row of rows) {
    const existing = merged.get(row.key);
    merged.set(row.key, existing === undefined ? row : addMetricRow(existing, row));
  }
  return [...merged.values()];
}

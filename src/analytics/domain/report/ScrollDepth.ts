/**
 * One path's scroll-depth aggregate for a range.
 *
 * The tracker (see `tracker/payload.ts`'s `newlyCrossedMilestones`) emits one
 * raw event per milestone newly crossed, so a single visitor reaching 75%
 * produces THREE raw rows (25, 50, 75) for the same path and session.
 * `AVG(value)` over those raw rows is wrong — it reports 50 for a visitor who
 * reached 75%. The correct statistic takes `MAX(value)` per (path,
 * session_id) first, then averages those maxima. `depthSum` is therefore the
 * sum of per-session maxima and `sessionsWithData` the count of sessions that
 * produced at least one scroll milestone for this path — additive across
 * days, so a range's average is `SUM(depthSum) / SUM(sessionsWithData)`.
 */
export interface ScrollDepthAggregate {
  readonly path: string;
  readonly depthSum: number;
  readonly sessionsWithData: number;
}

export function emptyScrollDepthAggregate(path: string): ScrollDepthAggregate {
  return { path, depthSum: 0, sessionsWithData: 0 };
}

function addScrollDepthAggregate(a: ScrollDepthAggregate, b: ScrollDepthAggregate): ScrollDepthAggregate {
  return {
    path: a.path,
    depthSum: a.depthSum + b.depthSum,
    sessionsWithData: a.sessionsWithData + b.sessionsWithData,
  };
}

/**
 * Combines rows from multiple sources (e.g. closed-day rollups plus today's
 * raw aggregate) into one row per path by summing counters. Each input row
 * must already be a per-day exact aggregate, so summing across days is sound
 * — mirrors `mergeMetricRowsByKey` in `Metrics.ts`.
 */
export function mergeScrollDepthAggregatesByPath(
  rows: readonly ScrollDepthAggregate[],
): ScrollDepthAggregate[] {
  const merged = new Map<string, ScrollDepthAggregate>();
  for (const row of rows) {
    const existing = merged.get(row.path);
    merged.set(row.path, existing === undefined ? row : addScrollDepthAggregate(existing, row));
  }
  return [...merged.values()];
}

/**
 * The average deepest-scroll-reached percentage (0-100), or `null` when no
 * session produced any scroll data for this path — never a division-by-zero
 * `NaN`, and never a misleading 0.
 */
export function averageScrollDepth(aggregate: ScrollDepthAggregate): number | null {
  return aggregate.sessionsWithData === 0 ? null : aggregate.depthSum / aggregate.sessionsWithData;
}

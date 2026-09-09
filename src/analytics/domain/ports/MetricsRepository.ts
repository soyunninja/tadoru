import type { SiteId } from '../event/SiteId.ts';
import type { TimeRange } from '../report/TimeRange.ts';
import type { Breakdown } from '../report/Breakdown.ts';
import type { MetricRow } from '../report/Metrics.ts';

/**
 * Driven port for reading aggregated metrics. Closed (already-rolled-up)
 * days and the still-open current day are queried separately because they
 * come from different sources — precomputed rollups vs. the raw events
 * table — and must be combined by the caller rather than mixed here.
 */
export interface MetricsRepository {
  queryRollup(site: SiteId, range: TimeRange, breakdown: Breakdown): Promise<readonly MetricRow[]>;
  queryRaw(site: SiteId, range: TimeRange, breakdown: Breakdown): Promise<readonly MetricRow[]>;
}

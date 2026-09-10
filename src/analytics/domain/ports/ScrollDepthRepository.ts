import type { SiteId } from '../event/SiteId.ts';
import type { TimeRange } from '../report/TimeRange.ts';
import type { ScrollDepthAggregate } from '../report/ScrollDepth.ts';

/**
 * Driven port for reading scroll-depth aggregates. Mirrors
 * `MetricsRepository`'s split: closed (already-rolled-up) days and the
 * still-open current day are queried separately because they come from
 * different sources — precomputed rollup vs. raw events — and must be
 * combined by the caller rather than mixed here.
 */
export interface ScrollDepthRepository {
  queryRollup(site: SiteId, range: TimeRange): Promise<readonly ScrollDepthAggregate[]>;
  queryRaw(site: SiteId, range: TimeRange): Promise<readonly ScrollDepthAggregate[]>;
}

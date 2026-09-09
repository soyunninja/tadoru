import type { Clock } from '../domain/ports/Clock.ts';
import type { MetricsRepository } from '../domain/ports/MetricsRepository.ts';
import type { SiteId } from '../domain/event/SiteId.ts';
import type { TimeRange } from '../domain/report/TimeRange.ts';
import { dayStart } from '../domain/report/TimeRange.ts';
import type { Breakdown } from '../domain/report/Breakdown.ts';
import type { MetricRow } from '../domain/report/Metrics.ts';
import { mergeMetricRowsByKey } from '../domain/report/Metrics.ts';

export interface QuerySiteMetricsDependencies {
  readonly metricsRepository: MetricsRepository;
  readonly clock: Clock;
}

/**
 * Dashboard read use case. Closed days are exact-only through their
 * precomputed rollups; today is still open, so it is read straight from raw
 * events. Both sources already report exact per-day distinct counts, so
 * summing them across days is sound — see SqliteRollupBuilder for why summing
 * across dimensions instead would not be.
 */
export class QuerySiteMetrics {
  readonly #metricsRepository: MetricsRepository;
  readonly #clock: Clock;

  constructor(dependencies: QuerySiteMetricsDependencies) {
    this.#metricsRepository = dependencies.metricsRepository;
    this.#clock = dependencies.clock;
  }

  async execute(site: SiteId, range: TimeRange, breakdown: Breakdown): Promise<readonly MetricRow[]> {
    const todayStart = dayStart(Math.floor(this.#clock.now().getTime() / 1000));
    const closedEnd = Math.min(range.endTs, todayStart);

    const rows: MetricRow[] = [];

    if (range.startTs < closedEnd) {
      const closedRange: TimeRange = { startTs: range.startTs, endTs: closedEnd };
      rows.push(...(await this.#metricsRepository.queryRollup(site, closedRange, breakdown)));
    }

    if (range.endTs > todayStart) {
      const todayRange: TimeRange = { startTs: Math.max(range.startTs, todayStart), endTs: range.endTs };
      rows.push(...(await this.#metricsRepository.queryRaw(site, todayRange, breakdown)));
    }

    return mergeMetricRowsByKey(rows);
  }
}

import type { Clock } from '../domain/ports/Clock.ts';
import type { ScrollDepthRepository } from '../domain/ports/ScrollDepthRepository.ts';
import type { SiteId } from '../domain/event/SiteId.ts';
import type { TimeRange } from '../domain/report/TimeRange.ts';
import { dayStart } from '../domain/report/TimeRange.ts';
import type { ScrollDepthAggregate } from '../domain/report/ScrollDepth.ts';
import { mergeScrollDepthAggregatesByPath } from '../domain/report/ScrollDepth.ts';

export interface QuerySiteScrollDepthDependencies {
  readonly scrollDepthRepository: ScrollDepthRepository;
  readonly clock: Clock;
}

/**
 * Dashboard read use case for per-path scroll depth. Mirrors
 * `QuerySiteMetrics`: closed days are exact-only through the precomputed
 * rollup; today is still open, so it is read straight from raw events. Both
 * sources report additive per-day sums (see `ScrollDepthAggregate`), so
 * summing them across days is sound.
 */
export class QuerySiteScrollDepth {
  readonly #scrollDepthRepository: ScrollDepthRepository;
  readonly #clock: Clock;

  constructor(dependencies: QuerySiteScrollDepthDependencies) {
    this.#scrollDepthRepository = dependencies.scrollDepthRepository;
    this.#clock = dependencies.clock;
  }

  async execute(site: SiteId, range: TimeRange): Promise<readonly ScrollDepthAggregate[]> {
    const todayStart = dayStart(Math.floor(this.#clock.now().getTime() / 1000));
    const closedEnd = Math.min(range.endTs, todayStart);

    const rows: ScrollDepthAggregate[] = [];

    if (range.startTs < closedEnd) {
      const closedRange: TimeRange = { startTs: range.startTs, endTs: closedEnd };
      rows.push(...(await this.#scrollDepthRepository.queryRollup(site, closedRange)));
    }

    if (range.endTs > todayStart) {
      const todayRange: TimeRange = { startTs: Math.max(range.startTs, todayStart), endTs: range.endTs };
      rows.push(...(await this.#scrollDepthRepository.queryRaw(site, todayRange)));
    }

    return mergeScrollDepthAggregatesByPath(rows);
  }
}

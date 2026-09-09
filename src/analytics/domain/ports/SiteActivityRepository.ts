import type { SiteId } from '../event/SiteId.ts';

/**
 * Whether anything has ever arrived for a site, and when the most recent
 * event landed. Deliberately not part of `MetricsRepository`: that port's
 * docblock scopes it to aggregated metrics over a `TimeRange`, while this is
 * an unbounded, operational "is it working at all" question with no range.
 */
export interface SiteActivity {
  readonly totalEvents: number;
  /** Epoch seconds of the most recent event, or null when none has arrived. */
  readonly lastEventTs: number | null;
}

/**
 * Driven port answering "has this configured site ever received an event".
 * A site the registry has never seen (no traffic yet, the normal first
 * state for a freshly configured site) must report zero/null rather than
 * fail — it is not an error condition.
 */
export interface SiteActivityRepository {
  activityFor(site: SiteId): Promise<SiteActivity>;
}

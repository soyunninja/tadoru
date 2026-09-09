import type { Clock } from '../domain/ports/Clock.ts';

/**
 * Driven capability for deleting expired raw events. Narrower than the
 * `EventRepository` port: only retention needs a bulk delete, and only this
 * use case needs to ask for one.
 */
export interface EventRetentionRepository {
  deleteOlderThan(cutoffTs: number): Promise<number>;
}

const DEFAULT_RETENTION_MONTHS = 25;

export interface PurgeExpiredDataDependencies {
  readonly eventRetention: EventRetentionRepository;
  readonly clock: Clock;
  readonly retentionMonths?: number;
}

/**
 * Retention cron use case. Raw events older than the configured retention
 * (25 months by default, matching the CNIL audience-measurement exemption)
 * are deleted; rollups are anonymous aggregates and are never purged.
 */
export class PurgeExpiredData {
  readonly #eventRetention: EventRetentionRepository;
  readonly #clock: Clock;
  readonly #retentionMonths: number;

  constructor(dependencies: PurgeExpiredDataDependencies) {
    this.#eventRetention = dependencies.eventRetention;
    this.#clock = dependencies.clock;
    this.#retentionMonths = dependencies.retentionMonths ?? DEFAULT_RETENTION_MONTHS;
  }

  async execute(): Promise<number> {
    const now = this.#clock.now();
    const cutoff = new Date(now);
    cutoff.setUTCMonth(cutoff.getUTCMonth() - this.#retentionMonths);
    const cutoffTs = Math.floor(cutoff.getTime() / 1000);

    return this.#eventRetention.deleteOlderThan(cutoffTs);
  }
}

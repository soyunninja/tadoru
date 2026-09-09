import type { FastifyInstance } from 'fastify';
import { isJobStale } from './jobStaleness.ts';

export interface JobHealthInput {
  readonly name: string;
  readonly intervalMs: number;
  readonly lastRunAt: number | undefined;
  readonly hasRun: boolean;
  readonly lastRunFailed: boolean;
}

export interface HealthRoutesDependencies {
  /** Runs a cheap reachability check (e.g. `SELECT 1`) against the database. Never throws. */
  readonly checkDatabase: () => boolean;
  /** Per-job health snapshot, in job order. */
  readonly jobStatuses: () => readonly JobHealthInput[];
  /** Epoch-millisecond timestamp of when the scheduler was started, or `undefined` if it never has been. */
  readonly schedulerStartedAt: () => number | undefined;
  /** Injectable clock for tests; defaults to `Date.now`. */
  readonly now?: () => number;
}

/**
 * Operational health endpoint. Deliberately reports only database
 * reachability and job timings — never port, host, data directory,
 * configured sites, or anything else from `Config` — so it stays safe to
 * expose without authentication.
 */
export function registerHealthRoutes(fastify: FastifyInstance, deps: HealthRoutesDependencies): void {
  const now = deps.now ?? Date.now;

  fastify.get('/health', async (_request, reply) => {
    let reachable: boolean;
    try {
      reachable = deps.checkDatabase();
    } catch {
      reachable = false;
    }

    const schedulerStartedAt = deps.schedulerStartedAt();
    const currentTime = now();

    const jobs: Record<
      string,
      {
        lastRunAt: number | null;
        hasRun: boolean;
        lastRunFailed: boolean;
        intervalMs: number;
        stale: boolean;
      }
    > = {};
    let anyJobStale = false;

    for (const job of deps.jobStatuses()) {
      const stale = isJobStale(job, currentTime, schedulerStartedAt);
      if (stale) anyJobStale = true;
      jobs[job.name] = {
        lastRunAt: job.lastRunAt ?? null,
        hasRun: job.hasRun,
        lastRunFailed: job.lastRunFailed,
        intervalMs: job.intervalMs,
        stale,
      };
    }

    const status: 'ok' | 'degraded' | 'error' = !reachable ? 'error' : anyJobStale ? 'degraded' : 'ok';

    const body = {
      status,
      database: { reachable },
      jobs,
    };

    return reply.code(reachable ? 200 : 503).send(body);
  });
}

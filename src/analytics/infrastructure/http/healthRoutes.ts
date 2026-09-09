import type { FastifyInstance } from 'fastify';

export interface HealthRoutesDependencies {
  /** Runs a cheap reachability check (e.g. `SELECT 1`) against the database. Never throws. */
  readonly checkDatabase: () => boolean;
  /** Epoch-millisecond timestamp of each scheduled job's last successful run, or `undefined` if it has not run yet. */
  readonly jobStatus: () => Readonly<Record<string, number | undefined>>;
}

/**
 * Operational health endpoint. Deliberately reports only database
 * reachability and job timestamps — never port, host, data directory,
 * configured sites, or anything else from `Config` — so it stays safe to
 * expose without authentication.
 */
export function registerHealthRoutes(fastify: FastifyInstance, deps: HealthRoutesDependencies): void {
  fastify.get('/health', async (_request, reply) => {
    let reachable: boolean;
    try {
      reachable = deps.checkDatabase();
    } catch {
      reachable = false;
    }

    const jobs = deps.jobStatus();
    const jobsWithNullFallback: Record<string, number | null> = {};
    for (const [name, lastRunAt] of Object.entries(jobs)) {
      jobsWithNullFallback[name] = lastRunAt ?? null;
    }

    const body = {
      status: reachable ? 'ok' : 'error',
      database: { reachable },
      jobs: jobsWithNullFallback,
    };

    return reply.code(reachable ? 200 : 503).send(body);
  });
}

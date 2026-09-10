import { join } from 'node:path';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import type { Clock } from '../../domain/ports/Clock.ts';
import { dayStart, SECONDS_PER_DAY } from '../../domain/report/TimeRange.ts';
import { RecordEvent } from '../../application/RecordEvent.ts';
import { RotateSalt } from '../../application/RotateSalt.ts';
import { PurgeExpiredData } from '../../application/PurgeExpiredData.ts';
import { openDatabase } from '../persistence/sqlite/Database.ts';
import { SqliteEventRepository } from '../persistence/sqlite/SqliteEventRepository.ts';
import { BatchingEventRepository } from '../persistence/sqlite/BatchingEventRepository.ts';
import { SqliteRollupBuilder } from '../persistence/sqlite/SqliteRollupBuilder.ts';
import { SqliteMetricsRepository } from '../persistence/sqlite/SqliteMetricsRepository.ts';
import { SqliteScrollDepthRepository } from '../persistence/sqlite/SqliteScrollDepthRepository.ts';
import { SqliteSiteActivityRepository } from '../persistence/sqlite/SqliteSiteActivityRepository.ts';
import { SqliteSiteRegistry } from '../persistence/sqlite/SqliteSiteRegistry.ts';
import { QuerySiteMetrics } from '../../application/QuerySiteMetrics.ts';
import { QuerySiteScrollDepth } from '../../application/QuerySiteScrollDepth.ts';
import { SqliteSaltProvider } from '../salt/SqliteSaltProvider.ts';
import { GeoipLiteResolver } from '../geo/GeoipLiteResolver.ts';
import { NodeDeviceDetectorResolver } from '../device/NodeDeviceDetectorResolver.ts';
import type { Config } from '../config/Config.ts';
import { registerCollectRoutes } from './collectRoutes.ts';
import { registerHealthRoutes } from './healthRoutes.ts';
import { registerTrackerRoutes, readTrackerScript } from './trackerRoutes.ts';
import { registerFontRoutes } from './fontRoutes.ts';
import { BUNDLED_FONT } from '../assets.ts';
import { registerAdminAuthRoutes } from './adminAuth.ts';
import { registerDashboardRoutes } from './dashboardRoutes.ts';
import { TokenBucketRateLimiter } from './rateLimit.ts';
import { Scheduler } from '../scheduler/Scheduler.ts';

const DATABASE_FILE_NAME = 'tadoru.db';

const ONE_HOUR_MS = 60 * 60 * 1000;
const ONE_DAY_MS = 24 * ONE_HOUR_MS;

// Ingest is a high-volume, unauthenticated public endpoint; login is a
// credential-guessing target. The login limiter is deliberately far
// stricter than the ingest one.
const INGEST_RATE_LIMIT_CAPACITY = 60;
const INGEST_RATE_LIMIT_PER_MINUTE = 60;
const LOGIN_RATE_LIMIT_CAPACITY = 5;
const LOGIN_RATE_LIMIT_PER_MINUTE = 5;

export interface BuildServerOptions {
  readonly config: Config;
  readonly clock?: Clock;
}

export interface TadoruServer {
  readonly fastify: FastifyInstance;
  readonly scheduler: Scheduler;
  /** Stops the scheduler, flushes any buffered events, and closes the HTTP server and database — safe to call from a SIGTERM handler. */
  close(): Promise<void>;
}

/**
 * Composition root for the HTTP layer: wires the already-built domain,
 * application and persistence layers into one running Fastify instance
 * plus its background scheduler. This is the only place in the codebase
 * that is allowed to know about every adapter at once.
 */
export function buildServer(options: BuildServerOptions): TadoruServer {
  const { config } = options;
  const clock: Clock = options.clock ?? { now: () => new Date() };

  const db = openDatabase(join(config.dataDir, DATABASE_FILE_NAME));

  const saltProvider = new SqliteSaltProvider(db);
  const geoResolver = new GeoipLiteResolver();
  const deviceResolver = new NodeDeviceDetectorResolver();
  const eventRepositoryDelegate = new SqliteEventRepository(db);
  const eventRepository = new BatchingEventRepository(eventRepositoryDelegate);
  const rollupBuilder = new SqliteRollupBuilder(db);
  const siteRegistry = new SqliteSiteRegistry(db);
  const querySiteMetrics = new QuerySiteMetrics({
    metricsRepository: new SqliteMetricsRepository(db, siteRegistry),
    clock,
  });
  const querySiteScrollDepth = new QuerySiteScrollDepth({
    scrollDepthRepository: new SqliteScrollDepthRepository(db, siteRegistry),
    clock,
  });

  const recordEvent = new RecordEvent({
    clock,
    saltProvider,
    geoResolver,
    deviceResolver,
    eventRepository,
    allowedSites: config.sites,
  });

  const rotateSalt = new RotateSalt({ saltRotator: saltProvider });
  const purgeExpiredData = new PurgeExpiredData({
    eventRetention: eventRepositoryDelegate,
    clock,
    retentionMonths: config.retention.rawEventMonths,
  });

  const scheduler = new Scheduler({
    clock,
    jobs: [
      {
        name: 'saltRotation',
        intervalMs: ONE_DAY_MS,
        run: async () => {
          await rotateSalt.execute();
        },
      },
      {
        name: 'rollupBuild',
        intervalMs: ONE_HOUR_MS,
        run: async () => {
          // Rebuilds yesterday's (now-closed) UTC day. Re-running is
          // idempotent, so an hourly cadence is just cheap insurance
          // against a missed run rather than a correctness requirement.
          const todayStart = dayStart(Math.floor(clock.now().getTime() / 1000));
          await rollupBuilder.execute(todayStart - SECONDS_PER_DAY);
        },
      },
      {
        name: 'retentionPurge',
        intervalMs: ONE_DAY_MS,
        run: async () => {
          await purgeExpiredData.execute();
        },
      },
    ],
  });

  const fastify = Fastify();

  registerCollectRoutes(fastify, {
    recordEvent,
    trustedProxy: config.trustedProxy,
    rateLimiter: new TokenBucketRateLimiter({
      capacity: INGEST_RATE_LIMIT_CAPACITY,
      refillPerMinute: INGEST_RATE_LIMIT_PER_MINUTE,
    }),
  });

  // Serving the bundle is what makes the documented <script> snippet work.
  const trackerScript = readTrackerScript();
  if (trackerScript === null) {
    fastify.log.warn('public/t.js is missing — /t.js will answer 503 and no JavaScript tracking will work');
  }
  registerTrackerRoutes(fastify, { trackerScript });

  // The dashboard's own typeface, self-hosted. Missing it is cosmetic: the CSS
  // stack falls back to a system monospace face.
  registerFontRoutes(fastify, { font: BUNDLED_FONT });

  registerHealthRoutes(fastify, {
    checkDatabase: () => {
      db.prepare('SELECT 1').get();
      return true;
    },
    jobStatuses: () => scheduler.getJobStatuses(),
    schedulerStartedAt: () => scheduler.getStartedAt(),
    now: () => clock.now().getTime(),
  });

  registerAdminAuthRoutes(fastify, {
    admin: config.admin,
    sessionSecret: config.session.secret,
    trustedProxy: config.trustedProxy,
    loginRateLimiter: new TokenBucketRateLimiter({
      capacity: LOGIN_RATE_LIMIT_CAPACITY,
      refillPerMinute: LOGIN_RATE_LIMIT_PER_MINUTE,
    }),
  });

  // The server-rendered admin UI. `adminAuth` above owns the JSON
  // /api/admin/* endpoints; these are the HTML pages, and they share the
  // same session cookie format and the same strict login rate limit.
  // Without this the sites page compiles and renders, but reports every site as
  // never having received an event — the dependency is optional in
  // dashboardRoutes so the view degrades instead of throwing.
  const siteActivity = new SqliteSiteActivityRepository(db, siteRegistry);

  registerDashboardRoutes(fastify, {
    sites: config.sites,
    admin: config.admin,
    sessionSecret: config.session.secret,
    trustedProxy: config.trustedProxy,
    loginRateLimiter: new TokenBucketRateLimiter({
      capacity: LOGIN_RATE_LIMIT_CAPACITY,
      refillPerMinute: LOGIN_RATE_LIMIT_PER_MINUTE,
    }),
    querySiteMetrics,
    querySiteScrollDepth,
    siteActivity,
    clock,
    ...(config.language !== undefined ? { configuredLocale: config.language } : {}),
  });

  scheduler.start();

  return {
    fastify,
    scheduler,
    async close() {
      scheduler.stop();
      await eventRepository.flush();
      await fastify.close();
      db.close();
    },
  };
}

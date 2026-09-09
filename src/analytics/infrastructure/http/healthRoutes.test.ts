import { test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { registerHealthRoutes } from './healthRoutes.ts';
import type { JobHealthInput } from './healthRoutes.ts';

interface JobBody {
  readonly lastRunAt: number | null;
  readonly hasRun: boolean;
  readonly lastRunFailed: boolean;
  readonly intervalMs: number;
  readonly stale: boolean;
}

interface HealthBody {
  readonly status: string;
  readonly database: { readonly reachable: boolean };
  readonly jobs: Record<string, JobBody>;
}

function job(overrides: Partial<JobHealthInput> & { name: string }): JobHealthInput {
  return {
    intervalMs: 1000,
    lastRunAt: undefined,
    hasRun: false,
    lastRunFailed: false,
    ...overrides,
  };
}

test('GET /health returns 200 and reachable:true when the database check succeeds', async () => {
  const fastify = Fastify();
  registerHealthRoutes(fastify, {
    checkDatabase: () => true,
    jobStatuses: () => [
      job({ name: 'saltRotation', intervalMs: 1000, lastRunAt: 1_700_000_000, hasRun: true }),
      job({ name: 'rollupBuild', intervalMs: 1000, lastRunAt: 1_700_000_500, hasRun: true }),
      job({ name: 'retentionPurge', intervalMs: 1000, lastRunAt: undefined, hasRun: false }),
    ],
    schedulerStartedAt: () => 1_700_000_000,
    now: () => 1_700_000_600,
  });

  const response = await fastify.inject({ method: 'GET', url: '/health' });
  assert.equal(response.statusCode, 200);
  const body = JSON.parse(response.payload) as HealthBody;
  assert.equal(body.status, 'ok');
  assert.equal(body.database.reachable, true);
  assert.equal(body.jobs['saltRotation']?.lastRunAt, 1_700_000_000);
  assert.equal(body.jobs['rollupBuild']?.lastRunAt, 1_700_000_500);
  assert.equal(body.jobs['retentionPurge']?.lastRunAt, null);
  assert.equal(body.jobs['retentionPurge']?.hasRun, false);
});

test('GET /health returns a non-200 status when the database is unreachable', async () => {
  const fastify = Fastify();
  registerHealthRoutes(fastify, {
    checkDatabase: () => false,
    jobStatuses: () => [],
    schedulerStartedAt: () => undefined,
  });

  const response = await fastify.inject({ method: 'GET', url: '/health' });
  assert.notEqual(response.statusCode, 200);
  const body = JSON.parse(response.payload) as HealthBody;
  assert.equal(body.status, 'error');
  assert.equal(body.database.reachable, false);
});

test('GET /health leaks no configuration: no port, host, sites, paths or secrets', () => {
  return (async () => {
    const fastify = Fastify();
    registerHealthRoutes(fastify, {
      checkDatabase: () => true,
      jobStatuses: () => [job({ name: 'saltRotation', hasRun: true, lastRunAt: 1 })],
      schedulerStartedAt: () => 0,
    });

    const response = await fastify.inject({ method: 'GET', url: '/health' });
    const raw = response.payload.toLowerCase();
    for (const forbidden of ['port', 'host', 'site', 'password', 'secret', 'datadir', 'admin']) {
      assert.ok(!raw.includes(forbidden), `response leaked "${forbidden}"`);
    }
  })();
});

test('GET /health survives checkDatabase throwing, reporting unreachable rather than crashing', async () => {
  const fastify = Fastify();
  registerHealthRoutes(fastify, {
    checkDatabase: () => {
      throw new Error('disk I/O error');
    },
    jobStatuses: () => [],
    schedulerStartedAt: () => undefined,
  });

  const response = await fastify.inject({ method: 'GET', url: '/health' });
  assert.notEqual(response.statusCode, 200);
  const body = JSON.parse(response.payload) as HealthBody;
  assert.equal(body.status, 'error');
  assert.equal(body.database.reachable, false);
});

test('overall status degrades to non-"ok" when the database is reachable but a job is stale', async () => {
  const fastify = Fastify();
  const now = 1_000_000;
  registerHealthRoutes(fastify, {
    checkDatabase: () => true,
    jobStatuses: () => [
      // Last succeeded far longer ago than twice its own interval: stale.
      job({ name: 'retentionPurge', intervalMs: 1000, hasRun: true, lastRunAt: now - 10_000 }),
    ],
    schedulerStartedAt: () => now - 20_000,
    now: () => now,
  });

  const response = await fastify.inject({ method: 'GET', url: '/health' });
  assert.equal(response.statusCode, 200);
  const body = JSON.parse(response.payload) as HealthBody;
  assert.notEqual(body.status, 'ok');
  assert.equal(body.status, 'degraded');
  assert.equal(body.jobs['retentionPurge']?.stale, true);
});

test('database unreachable takes priority over status even when a job is also stale', async () => {
  const fastify = Fastify();
  const now = 1_000_000;
  registerHealthRoutes(fastify, {
    checkDatabase: () => false,
    jobStatuses: () => [job({ name: 'retentionPurge', intervalMs: 1000, hasRun: true, lastRunAt: now - 10_000 })],
    schedulerStartedAt: () => now - 20_000,
    now: () => now,
  });

  const response = await fastify.inject({ method: 'GET', url: '/health' });
  assert.equal(response.statusCode, 503);
  const body = JSON.parse(response.payload) as HealthBody;
  assert.equal(body.status, 'error');
});

test('a job whose last attempt threw is reported as lastRunFailed regardless of staleness', async () => {
  const fastify = Fastify();
  const now = 1_000_000;
  registerHealthRoutes(fastify, {
    checkDatabase: () => true,
    jobStatuses: () => [job({ name: 'saltRotation', intervalMs: 1000, hasRun: true, lastRunAt: now - 10, lastRunFailed: true })],
    schedulerStartedAt: () => now - 20,
    now: () => now,
  });

  const response = await fastify.inject({ method: 'GET', url: '/health' });
  const body = JSON.parse(response.payload) as HealthBody;
  assert.equal(body.jobs['saltRotation']?.lastRunFailed, true);
  assert.equal(body.jobs['saltRotation']?.stale, false);
});

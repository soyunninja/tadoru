import { test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { registerHealthRoutes } from './healthRoutes.ts';

test('GET /health returns 200 and reachable:true when the database check succeeds', async () => {
  const fastify = Fastify();
  registerHealthRoutes(fastify, {
    checkDatabase: () => true,
    jobStatus: () => ({ saltRotation: 1_700_000_000, rollupBuild: 1_700_000_500, retentionPurge: undefined }),
  });

  const response = await fastify.inject({ method: 'GET', url: '/health' });
  assert.equal(response.statusCode, 200);
  const body = JSON.parse(response.payload) as {
    status: string;
    database: { reachable: boolean };
    jobs: Record<string, number | null>;
  };
  assert.equal(body.database.reachable, true);
  assert.equal(body.jobs['saltRotation'], 1_700_000_000);
  assert.equal(body.jobs['rollupBuild'], 1_700_000_500);
  assert.equal(body.jobs['retentionPurge'], null);
});

test('GET /health returns a non-200 status when the database is unreachable', async () => {
  const fastify = Fastify();
  registerHealthRoutes(fastify, {
    checkDatabase: () => false,
    jobStatus: () => ({}),
  });

  const response = await fastify.inject({ method: 'GET', url: '/health' });
  assert.notEqual(response.statusCode, 200);
  const body = JSON.parse(response.payload) as { database: { reachable: boolean } };
  assert.equal(body.database.reachable, false);
});

test('GET /health leaks no configuration: no port, host, sites, paths or secrets', () => {
  return (async () => {
    const fastify = Fastify();
    registerHealthRoutes(fastify, {
      checkDatabase: () => true,
      jobStatus: () => ({}),
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
    jobStatus: () => ({}),
  });

  const response = await fastify.inject({ method: 'GET', url: '/health' });
  assert.notEqual(response.statusCode, 200);
  const body = JSON.parse(response.payload) as { database: { reachable: boolean } };
  assert.equal(body.database.reachable, false);
});

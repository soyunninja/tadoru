import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildServer } from './server.ts';
import { loadConfig } from '../config/loadConfig.ts';
import { BUNDLED_FONT_URL } from '../assets.ts';

function withServer(fn: (server: ReturnType<typeof buildServer>) => Promise<void>): () => Promise<void> {
  return async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'tadoru-server-test-'));
    const loaded = loadConfig({
      env: {
        TADORU_DATA_DIR: dataDir,
        TADORU_ADMIN_PASSWORD: 'a-genuinely-strong-password',
        TADORU_SITES: 'example.com',
      },
    });
    assert.equal(loaded.ok, true);
    if (!loaded.ok) return;

    const server = buildServer({ config: loaded.value.config });
    try {
      await fn(server);
    } finally {
      await server.close();
      rmSync(dataDir, { recursive: true, force: true });
    }
  };
}

test('GET /health reports the database as reachable', withServer(async (server) => {
  const response = await server.fastify.inject({ method: 'GET', url: '/health' });
  assert.equal(response.statusCode, 200);
  const body = JSON.parse(response.payload) as { database: { reachable: boolean } };
  assert.equal(body.database.reachable, true);
}));

test('GET /health reports every scheduled job by name', withServer(async (server) => {
  const response = await server.fastify.inject({ method: 'GET', url: '/health' });
  const body = JSON.parse(response.payload) as { jobs: Record<string, number | null> };
  assert.ok('saltRotation' in body.jobs);
  assert.ok('rollupBuild' in body.jobs);
  assert.ok('retentionPurge' in body.jobs);
}));

test('POST /api/event on an allowed site responds 204', withServer(async (server) => {
  const response = await server.fastify.inject({
    method: 'POST',
    url: '/api/event',
    headers: { origin: 'https://example.com', 'content-type': 'application/json' },
    payload: { type: 'pageview', path: '/' },
  });
  assert.equal(response.statusCode, 204);
}));

test('GET /t.gif returns the tracking pixel', withServer(async (server) => {
  const response = await server.fastify.inject({
    method: 'GET',
    url: '/t.gif',
    headers: { referer: 'https://example.com/page' },
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['content-type'], 'image/gif');
}));

test('admin login succeeds with the configured password', withServer(async (server) => {
  const response = await server.fastify.inject({
    method: 'POST',
    url: '/api/admin/login',
    payload: { password: 'a-genuinely-strong-password' },
  });
  assert.equal(response.statusCode, 200);
  assert.ok(response.headers['set-cookie']);
}));

test('admin login rejects the wrong password', withServer(async (server) => {
  const response = await server.fastify.inject({
    method: 'POST',
    url: '/api/admin/login',
    payload: { password: 'nope' },
  });
  assert.equal(response.statusCode, 401);
}));

test('the scheduler is running once the server is built', withServer(async (server) => {
  // Jobs have not fired yet (their first interval has not elapsed), but the
  // scheduler must already be tracking them.
  const names = Object.keys(server.scheduler.getLastRunTimes());
  assert.ok(names.length >= 3);
}));

test('close() stops the scheduler and closes fastify without throwing', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'tadoru-server-test-'));
  try {
    const loaded = loadConfig({
      env: {
        TADORU_DATA_DIR: dataDir,
        TADORU_ADMIN_PASSWORD: 'a-genuinely-strong-password',
        TADORU_SITES: 'example.com',
      },
    });
    assert.equal(loaded.ok, true);
    if (!loaded.ok) return;
    const server = buildServer({ config: loaded.value.config });
    await assert.doesNotReject(server.close());
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('the dashboard is actually reachable from the built server', withServer(async (server) => {
  // The dashboard existing is not the same as the dashboard being registered.
  // Without this, every page below 404s and nobody notices until deployment.
  const login = await server.fastify.inject({ method: 'GET', url: '/login' });
  assert.equal(login.statusCode, 200);
  assert.match(login.headers['content-type'] as string, /text\/html/);

  // Unauthenticated access must redirect to the login page, not 404.
  const dashboard = await server.fastify.inject({ method: 'GET', url: '/dashboard' });
  assert.equal(dashboard.statusCode, 302);
  assert.equal(dashboard.headers['location'], '/login');
}));

test('every dashboard page links to its source, as AGPL section 13 requires', withServer(async (server) => {
  const login = await server.fastify.inject({ method: 'GET', url: '/login' });
  assert.match(login.body, /github\.com/);
  assert.match(login.body, /0\.1\.0/);
}));

test('the built server serves the tracker bundle the README tells people to embed', withServer(async (server) => {
  const response = await server.fastify.inject({ method: 'GET', url: '/t.js' });
  assert.equal(response.statusCode, 200);
  assert.match(response.headers['content-type'] as string, /javascript/);
  assert.match(response.body, /AGPL-3\.0-only/);
}));

test('the built server serves its own web font, and the CSP allows it', withServer(async (server) => {
  const font = await server.fastify.inject({ method: 'GET', url: BUNDLED_FONT_URL });
  assert.equal(font.statusCode, 200);
  assert.equal(font.headers['content-type'], 'font/woff2');
  assert.ok(font.rawPayload.length > 10_000, 'the real subset should be served, not a stub');

  // A font-src the policy forbids would block it in the browser even though
  // the route works, so assert the policy too.
  const page = await server.fastify.inject({ method: 'GET', url: '/login' });
  assert.match(page.headers['content-security-policy'] as string, /font-src 'self'/);
}));

test('the sites page reports real activity, not a permanent "never received"', withServer(async (server) => {
  // The dependency is optional in dashboardRoutes so the page degrades instead
  // of throwing when it is absent. That means forgetting to wire the adapter
  // here would ship a feature that silently always says "no events yet" — this
  // is the only place that catches it.
  await server.fastify.inject({
    method: 'GET',
    url: '/t.gif',
    headers: { referer: 'https://example.com/hello' },
  });

  // Ingest buffers writes, so flush before reading.
  await new Promise((resolve) => setTimeout(resolve, 1200));

  const login = await server.fastify.inject({
    method: 'POST',
    url: '/api/admin/login',
    payload: { password: 'a-genuinely-strong-password' },
  });
  const cookie = login.headers['set-cookie'];
  assert.ok(cookie, 'login should set a session cookie');

  const page = await server.fastify.inject({
    method: 'GET',
    url: '/dashboard',
    headers: { cookie: Array.isArray(cookie) ? cookie.join('; ') : cookie },
  });

  assert.equal(page.statusCode, 200);
  assert.match(page.body, /events total/, 'the site should report the events it received');
  assert.ok(!/No events received yet/.test(page.body), 'it must not still claim nothing arrived');
}));

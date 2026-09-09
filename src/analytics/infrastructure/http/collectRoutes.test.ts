import { test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { registerCollectRoutes } from './collectRoutes.ts';
import type { RecordEventUseCase } from './collectRoutes.ts';
import { TokenBucketRateLimiter } from './rateLimit.ts';
import { ok, err } from '../../../shared/Result.ts';
import type { RecordEventInput } from '../../application/RecordEvent.ts';

class RecordingUseCase implements RecordEventUseCase {
  readonly calls: RecordEventInput[] = [];
  #shouldAllow: boolean;

  constructor(shouldAllow = true) {
    this.#shouldAllow = shouldAllow;
  }

  execute(input: RecordEventInput) {
    this.calls.push(input);
    return Promise.resolve(this.#shouldAllow ? ok({} as never) : err('site_not_allowed' as const));
  }
}

function buildApp(useCase: RecordEventUseCase, trustedProxy = false): FastifyInstance {
  const fastify = Fastify();
  registerCollectRoutes(fastify, {
    recordEvent: useCase,
    trustedProxy,
    rateLimiter: new TokenBucketRateLimiter({ capacity: 1000, refillPerMinute: 6000 }),
  });
  return fastify;
}

test('GET /t.gif returns a 1x1 transparent gif with no-cache headers', async () => {
  const fastify = buildApp(new RecordingUseCase());
  const response = await fastify.inject({ method: 'GET', url: '/t.gif', headers: { referer: 'https://example.com/page' } });

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['content-type'], 'image/gif');
  assert.equal(response.headers['cache-control'], 'no-store, no-cache, must-revalidate');
  assert.equal(response.headers['pragma'], 'no-cache');
  assert.equal(response.headers['expires'], '0');
  assert.ok(response.rawPayload.length > 0);
});

test('GET /t.gif resolves the site from Referer and records a pageview', async () => {
  const useCase = new RecordingUseCase();
  const fastify = buildApp(useCase);
  await fastify.inject({
    method: 'GET',
    url: '/t.gif',
    headers: { referer: 'https://example.com/blog/post', 'user-agent': 'Mozilla/5.0 Test' },
    remoteAddress: '198.51.100.1',
  });

  assert.equal(useCase.calls.length, 1);
  const [call] = useCase.calls;
  assert.ok(call);
  assert.equal(call.siteHeader, 'https://example.com/blog/post');
  assert.equal(call.userAgent, 'Mozilla/5.0 Test');
  assert.equal(call.ip, '198.51.100.1');
  assert.equal(call.type, 'pageview');
  assert.equal(call.path, '/blog/post');
});

test('GET /t.gif responds identically whether the referer domain is allowed or not', async () => {
  const allowedApp = buildApp(new RecordingUseCase(true));
  const disallowedApp = buildApp(new RecordingUseCase(false));

  const allowedResponse = await allowedApp.inject({
    method: 'GET',
    url: '/t.gif',
    headers: { referer: 'https://allowed.com/page' },
  });
  const disallowedResponse = await disallowedApp.inject({
    method: 'GET',
    url: '/t.gif',
    headers: { referer: 'https://not-allowed.com/page' },
  });

  assert.equal(allowedResponse.statusCode, disallowedResponse.statusCode);
  assert.deepEqual(allowedResponse.rawPayload, disallowedResponse.rawPayload);
  assert.equal(allowedResponse.headers['content-type'], disallowedResponse.headers['content-type']);
  assert.equal(allowedResponse.headers['cache-control'], disallowedResponse.headers['cache-control']);
});

test('GET /t.gif with no Referer at all still returns the pixel and records nothing usable', async () => {
  const useCase = new RecordingUseCase();
  const fastify = buildApp(useCase);
  const response = await fastify.inject({ method: 'GET', url: '/t.gif' });
  assert.equal(response.statusCode, 200);
});

test('POST /api/event responds 204 with no body', async () => {
  const fastify = buildApp(new RecordingUseCase());
  const response = await fastify.inject({
    method: 'POST',
    url: '/api/event',
    headers: { origin: 'https://example.com', 'content-type': 'application/json' },
    payload: { type: 'pageview', path: '/blog/post' },
  });

  assert.equal(response.statusCode, 204);
  assert.equal(response.rawPayload.length, 0);
});

test('POST /api/event maps the JSON body and headers onto RecordEventInput', async () => {
  const useCase = new RecordingUseCase();
  const fastify = buildApp(useCase);
  await fastify.inject({
    method: 'POST',
    url: '/api/event',
    headers: {
      origin: 'https://example.com',
      'content-type': 'application/json',
      'user-agent': 'Mozilla/5.0 Test',
    },
    remoteAddress: '198.51.100.2',
    payload: { type: 'custom', path: '/pricing', name: 'signup', value: 1, props: { plan: 'pro' } },
  });

  assert.equal(useCase.calls.length, 1);
  const [call] = useCase.calls;
  assert.ok(call);
  assert.equal(call.siteHeader, 'https://example.com');
  assert.equal(call.ip, '198.51.100.2');
  assert.equal(call.userAgent, 'Mozilla/5.0 Test');
  assert.equal(call.type, 'custom');
  assert.equal(call.path, '/pricing');
  assert.equal(call.name, 'signup');
  assert.equal(call.value, 1);
  assert.deepEqual(call.props, { plan: 'pro' });
});

test('POST /api/event responds identically whether the origin domain is allowed or not', async () => {
  const allowedApp = buildApp(new RecordingUseCase(true));
  const disallowedApp = buildApp(new RecordingUseCase(false));

  const payload = { type: 'pageview', path: '/' };
  const allowedResponse = await allowedApp.inject({
    method: 'POST',
    url: '/api/event',
    headers: { origin: 'https://allowed.com', 'content-type': 'application/json' },
    payload,
  });
  const disallowedResponse = await disallowedApp.inject({
    method: 'POST',
    url: '/api/event',
    headers: { origin: 'https://not-allowed.com', 'content-type': 'application/json' },
    payload,
  });

  assert.equal(allowedResponse.statusCode, disallowedResponse.statusCode);
  assert.deepEqual(allowedResponse.rawPayload, disallowedResponse.rawPayload);
  assert.equal(
    allowedResponse.headers['access-control-allow-origin'],
    'https://allowed.com',
    'CORS should echo the requesting origin, not depend on allow-list status',
  );
});

test('POST /api/event rejects bodies larger than 8 KB', async () => {
  const fastify = buildApp(new RecordingUseCase());
  const oversizedProp = 'x'.repeat(9 * 1024);
  const response = await fastify.inject({
    method: 'POST',
    url: '/api/event',
    headers: { origin: 'https://example.com', 'content-type': 'application/json' },
    payload: { type: 'pageview', path: '/', props: { big: oversizedProp } },
  });

  assert.equal(response.statusCode, 413);
});

test('POST /api/event never awaits persistence: responds even if the use case never resolves', async () => {
  const neverResolving: RecordEventUseCase = { execute: () => new Promise(() => {}) };
  const fastify = buildApp(neverResolving);
  const response = await fastify.inject({
    method: 'POST',
    url: '/api/event',
    headers: { origin: 'https://example.com', 'content-type': 'application/json' },
    payload: { type: 'pageview', path: '/' },
  });
  assert.equal(response.statusCode, 204);
});

test('OPTIONS /api/event handles CORS preflight', async () => {
  const fastify = buildApp(new RecordingUseCase());
  const response = await fastify.inject({
    method: 'OPTIONS',
    url: '/api/event',
    headers: { origin: 'https://example.com', 'access-control-request-method': 'POST' },
  });

  assert.equal(response.statusCode, 204);
  assert.equal(response.headers['access-control-allow-origin'], 'https://example.com');
  assert.match(String(response.headers['access-control-allow-methods']), /POST/);
});

test('CORS never combines a wildcard origin with credentials', async () => {
  const fastify = buildApp(new RecordingUseCase());
  const response = await fastify.inject({
    method: 'POST',
    url: '/api/event',
    headers: { origin: 'https://example.com', 'content-type': 'application/json' },
    payload: { type: 'pageview', path: '/' },
  });
  assert.notEqual(response.headers['access-control-allow-origin'], '*');
  assert.equal(response.headers['access-control-allow-credentials'], undefined);
});

test('rate limiting silently drops events past the burst without changing the response', async () => {
  const useCase = new RecordingUseCase();
  const fastify = Fastify();
  registerCollectRoutes(fastify, {
    recordEvent: useCase,
    trustedProxy: false,
    rateLimiter: new TokenBucketRateLimiter({ capacity: 1, refillPerMinute: 60 }),
  });

  const first = await fastify.inject({
    method: 'POST',
    url: '/api/event',
    headers: { origin: 'https://example.com', 'content-type': 'application/json' },
    remoteAddress: '203.0.113.9',
    payload: { type: 'pageview', path: '/' },
  });
  const second = await fastify.inject({
    method: 'POST',
    url: '/api/event',
    headers: { origin: 'https://example.com', 'content-type': 'application/json' },
    remoteAddress: '203.0.113.9',
    payload: { type: 'pageview', path: '/' },
  });

  assert.equal(first.statusCode, 204);
  assert.equal(second.statusCode, 204);
  assert.equal(useCase.calls.length, 1);
});

test('a persistence failure is logged rather than swallowed in silence', async () => {
  // Swallowing this entirely means that when the database starts failing, events
  // vanish and the operator gets no signal at all. The caller must still see a
  // normal response, but the failure has to leave a trace on the server.
  const logged: unknown[] = [];
  const failing = {
    execute: () => Promise.reject(new Error('database is gone')),
  } as unknown as RecordEventUseCase;

  const app = Fastify();
  app.log.error = ((...args: unknown[]) => {
    logged.push(args);
  }) as typeof app.log.error;

  registerCollectRoutes(app, {
    recordEvent: failing,
    trustedProxy: false,
    rateLimiter: new TokenBucketRateLimiter({ capacity: 1000, refillPerMinute: 6000 }),
  });

  const response = await app.inject({
    method: 'GET',
    url: '/t.gif',
    headers: { referer: 'https://allowed.com/page' },
  });

  // The visitor still gets a clean pixel.
  assert.equal(response.statusCode, 200);

  // Give the rejected promise a turn to settle.
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(logged.length, 1, 'the ingest failure should have been logged');
});

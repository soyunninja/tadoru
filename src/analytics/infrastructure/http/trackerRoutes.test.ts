import { test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { registerTrackerRoutes } from './trackerRoutes.ts';

const SCRIPT = Buffer.from('/*! Tadoru v0.1.0 | AGPL-3.0-only | https://example.test/repo */\nconsole.log(1)\n');

function buildApp(script: Buffer | null) {
  const fastify = Fastify();
  registerTrackerRoutes(fastify, { trackerScript: script });
  return fastify;
}

// The README tells every operator to embed <script src=".../t.js">. If this
// route is missing, that snippet 404s and the product silently collects nothing
// from any visitor running JavaScript.
test('GET /t.js serves the tracker bundle', async () => {
  const response = await buildApp(SCRIPT).inject({ method: 'GET', url: '/t.js' });
  assert.equal(response.statusCode, 200);
  assert.match(response.headers['content-type'] as string, /javascript/);
  assert.equal(response.rawPayload.toString(), SCRIPT.toString());
});

test('the served bundle keeps its AGPL licence banner', async () => {
  const response = await buildApp(SCRIPT).inject({ method: 'GET', url: '/t.js' });
  assert.match(response.body, /AGPL-3\.0-only/);
});

test('the bundle is cacheable but revalidated, so an update reaches visitors', async () => {
  const response = await buildApp(SCRIPT).inject({ method: 'GET', url: '/t.js' });
  const cacheControl = response.headers['cache-control'] as string;
  assert.match(cacheControl, /max-age=\d+/);
  assert.ok(!/no-store/.test(cacheControl), 'the tracker should be cacheable, unlike the pixel');
});

test('any site may embed the script, so it is served cross-origin', async () => {
  const response = await buildApp(SCRIPT).inject({ method: 'GET', url: '/t.js' });
  assert.equal(response.headers['access-control-allow-origin'], '*');
});

test('a missing bundle answers 503, not a silent 404 that looks like a typo', async () => {
  const response = await buildApp(null).inject({ method: 'GET', url: '/t.js' });
  assert.equal(response.statusCode, 503);
  assert.match(response.body, /build/i);
});

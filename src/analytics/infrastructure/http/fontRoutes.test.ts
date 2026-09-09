import { test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { registerFontRoutes } from './fontRoutes.ts';
import { fontUrlFor } from '../assets.ts';

const FONT = Buffer.from('wOF2fake');
const FONT_URL = fontUrlFor(FONT);

function buildApp(font: Buffer | null) {
  const fastify = Fastify();
  registerFontRoutes(fastify, { font });
  return fastify;
}

test('serves the subsetted web font', async () => {
  const response = await buildApp(FONT).inject({ method: 'GET', url: FONT_URL });
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['content-type'], 'font/woff2');
  assert.deepEqual(response.rawPayload, FONT);
});

// The file is content-addressed by name and never changes in place, so it can
// be cached hard. A regenerated subset ships under a new release anyway.
test('the font is cached aggressively and immutably', async () => {
  const response = await buildApp(FONT).inject({ method: 'GET', url: FONT_URL });
  const cacheControl = response.headers['cache-control'] as string;
  assert.match(cacheControl, /max-age=\d{5,}/);
  assert.match(cacheControl, /immutable/);
});

test('the url carries a digest of the font, so a regenerated subset is a new url', () => {
  // Without this, an immutable year-long cache strands every browser that
  // already fetched an older subset — new icons would never reach them.
  const other = Buffer.from('wOF2different');
  assert.notEqual(fontUrlFor(FONT), fontUrlFor(other));
  assert.match(fontUrlFor(FONT), /\/assets\/jetbrains-mono\.[0-9a-f]{12}\.woff2/);
  assert.equal(fontUrlFor(FONT), fontUrlFor(Buffer.from('wOF2fake')));
});

test('a missing font degrades to 404 rather than breaking the page', async () => {
  // The dashboard must still render: the CSS stack falls back to a system
  // monospace face, so a missing font is cosmetic, never fatal.
  const response = await buildApp(null).inject({ method: 'GET', url: FONT_URL });
  assert.equal(response.statusCode, 404);
});

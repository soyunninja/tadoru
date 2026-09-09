import { test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import {
  hashPassword,
  verifyPasswordHash,
  signSessionValue,
  verifySessionValue,
  buildSessionCookieHeader,
  isSecureRequest,
  registerAdminAuthRoutes,
  SESSION_COOKIE_NAME,
} from './adminAuth.ts';
import { TokenBucketRateLimiter } from './rateLimit.ts';

test('hashPassword derives a scrypt hash paired with a random salt', () => {
  const first = hashPassword('correct horse battery staple');
  const second = hashPassword('correct horse battery staple');

  assert.notEqual(first.salt, second.salt, 'salts should be randomly generated');
  assert.notEqual(first.hash, second.hash, 'different salts should yield different hashes');
});

test('verifyPasswordHash accepts the correct password', () => {
  const stored = hashPassword('correct horse battery staple');
  assert.equal(verifyPasswordHash('correct horse battery staple', stored), true);
});

test('verifyPasswordHash rejects an incorrect password', () => {
  const stored = hashPassword('correct horse battery staple');
  assert.equal(verifyPasswordHash('wrong password', stored), false);
});

test('verifyPasswordHash rejects without throwing when hash lengths differ', () => {
  const stored = hashPassword('correct horse battery staple');
  const tampered = { salt: stored.salt, hash: `${stored.hash}00` };
  assert.equal(verifyPasswordHash('correct horse battery staple', tampered), false);
});

test('signSessionValue and verifySessionValue round-trip', () => {
  const signed = signSessionValue('session-payload', 'secret-key');
  assert.equal(verifySessionValue(signed, 'secret-key'), 'session-payload');
});

test('verifySessionValue rejects a tampered value', () => {
  const signed = signSessionValue('session-payload', 'secret-key');
  const tampered = signed.replace('session-payload', 'session-hacked');
  assert.equal(verifySessionValue(tampered, 'secret-key'), undefined);
});

test('verifySessionValue rejects a value signed with a different secret', () => {
  const signed = signSessionValue('session-payload', 'secret-key');
  assert.equal(verifySessionValue(signed, 'another-secret'), undefined);
});

test('verifySessionValue rejects a malformed value', () => {
  assert.equal(verifySessionValue('not-signed-at-all', 'secret-key'), undefined);
});

test('buildSessionCookieHeader sets httpOnly, SameSite=Lax and Path=/', () => {
  const header = buildSessionCookieHeader('signed-value', { secure: false });
  assert.match(header, new RegExp(`^${SESSION_COOKIE_NAME}=signed-value`));
  assert.match(header, /HttpOnly/);
  assert.match(header, /SameSite=Lax/);
  assert.match(header, /Path=\//);
  assert.doesNotMatch(header, /Secure/);
});

test('buildSessionCookieHeader adds Secure when the request arrived over TLS', () => {
  const header = buildSessionCookieHeader('signed-value', { secure: true });
  assert.match(header, /Secure/);
});

test('isSecureRequest is false when trustedProxy is false, even if the header claims https', () => {
  assert.equal(isSecureRequest({ 'x-forwarded-proto': 'https' }, false), false);
});

test('isSecureRequest is true when trustedProxy is true and the header says https', () => {
  assert.equal(isSecureRequest({ 'x-forwarded-proto': 'https' }, true), true);
});

test('isSecureRequest is false when trustedProxy is true but the header says http', () => {
  assert.equal(isSecureRequest({ 'x-forwarded-proto': 'http' }, true), false);
});

function buildLoginApp(overrides: { password?: string; capacity?: number; trustedProxy?: boolean } = {}) {
  const admin = hashPassword(overrides.password ?? 'a-real-admin-password');
  const fastify = Fastify();
  const loginRateLimiter = new TokenBucketRateLimiter({ capacity: overrides.capacity ?? 5, refillPerMinute: 5 });
  registerAdminAuthRoutes(fastify, {
    admin: { passwordHash: admin.hash, passwordSalt: admin.salt },
    sessionSecret: 'test-session-secret',
    trustedProxy: overrides.trustedProxy ?? false,
    loginRateLimiter,
  });
  return fastify;
}

test('logging in with the correct password succeeds and sets a session cookie', async () => {
  const fastify = buildLoginApp({ password: 'a-real-admin-password' });
  const response = await fastify.inject({
    method: 'POST',
    url: '/api/admin/login',
    payload: { password: 'a-real-admin-password' },
  });

  assert.equal(response.statusCode, 200);
  const cookie = response.headers['set-cookie'];
  assert.ok(cookie);
  assert.match(String(cookie), new RegExp(`^${SESSION_COOKIE_NAME}=`));
  assert.match(String(cookie), /HttpOnly/);
  assert.match(String(cookie), /SameSite=Lax/);
});

test('logging in with the wrong password fails with a generic 401', async () => {
  const fastify = buildLoginApp({ password: 'a-real-admin-password' });
  const response = await fastify.inject({
    method: 'POST',
    url: '/api/admin/login',
    payload: { password: 'totally-wrong' },
  });

  assert.equal(response.statusCode, 401);
  assert.equal(response.headers['set-cookie'], undefined);
});

test('the login route enforces a stricter rate limit than ingest', async () => {
  const fastify = buildLoginApp({ password: 'a-real-admin-password', capacity: 2 });

  const attempt = () =>
    fastify.inject({
      method: 'POST',
      url: '/api/admin/login',
      remoteAddress: '203.0.113.55',
      payload: { password: 'wrong' },
    });

  const first = await attempt();
  const second = await attempt();
  const third = await attempt();

  assert.equal(first.statusCode, 401);
  assert.equal(second.statusCode, 401);
  assert.equal(third.statusCode, 429);
});

test('logging out clears the session cookie', async () => {
  const fastify = buildLoginApp();
  const response = await fastify.inject({ method: 'POST', url: '/api/admin/logout' });
  assert.equal(response.statusCode, 204);
  const cookie = String(response.headers['set-cookie']);
  assert.match(cookie, /Max-Age=0/);
});

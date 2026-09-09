import { randomBytes, scryptSync, timingSafeEqual, createHmac } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { HeaderMap } from './requestContext.ts';
import type { TokenBucketRateLimiter } from './rateLimit.ts';
import { resolveClientIp } from './requestContext.ts';

/**
 * NOTE ON COOKIE LAWFULNESS: the cookie this module issues authenticates the
 * site operator to their own dashboard. It is strictly necessary for a
 * service the operator explicitly requested (logging into their own admin
 * panel), which places it under the ePrivacy Art. 5(3) exemption for
 * cookies "strictly necessary" to provide a service the user asked for —
 * the same exemption category as a shopping-cart cookie, not the audience
 * -measurement exemption the rest of this product relies on. It is never
 * set for, or sent to, visitors of the measured sites; only for requests to
 * the admin dashboard itself.
 */
export const SESSION_COOKIE_NAME = 'tadoru_session';

const SCRYPT_KEY_LENGTH = 64;
const SALT_BYTE_LENGTH = 16;

export interface PasswordHash {
  readonly salt: string;
  readonly hash: string;
}

/**
 * Derives a scrypt hash for `password`. A fresh random salt is generated
 * unless one is supplied (re-hashing with a known salt is only used
 * internally to verify a candidate password against a stored hash).
 */
export function hashPassword(password: string, salt: string = randomBytes(SALT_BYTE_LENGTH).toString('hex')): PasswordHash {
  const hash = scryptSync(password, salt, SCRYPT_KEY_LENGTH).toString('hex');
  return { salt, hash };
}

/**
 * Verifies a candidate password against a stored hash using a
 * constant-time comparison, so a mistyped password cannot be distinguished
 * from a correct one by response timing.
 */
export function verifyPasswordHash(candidatePassword: string, expected: PasswordHash): boolean {
  const candidateHash = scryptSync(candidatePassword, expected.salt, SCRYPT_KEY_LENGTH);
  const expectedHash = Buffer.from(expected.hash, 'hex');
  if (candidateHash.length !== expectedHash.length) {
    return false;
  }
  return timingSafeEqual(candidateHash, expectedHash);
}

/** Signs an opaque session value with an HMAC so it cannot be forged or tampered with. */
export function signSessionValue(value: string, secret: string): string {
  const signature = createHmac('sha256', secret).update(value).digest('hex');
  return `${value}.${signature}`;
}

/** Verifies a signed session value, returning the original value or `undefined` if invalid. */
export function verifySessionValue(signedValue: string, secret: string): string | undefined {
  const separatorIndex = signedValue.lastIndexOf('.');
  if (separatorIndex === -1) {
    return undefined;
  }

  const value = signedValue.slice(0, separatorIndex);
  const providedSignature = signedValue.slice(separatorIndex + 1);
  const expectedSignature = createHmac('sha256', secret).update(value).digest('hex');

  const providedBuf = Buffer.from(providedSignature, 'hex');
  const expectedBuf = Buffer.from(expectedSignature, 'hex');
  if (providedBuf.length !== expectedBuf.length || providedBuf.length === 0) {
    return undefined;
  }
  return timingSafeEqual(providedBuf, expectedBuf) ? value : undefined;
}

export interface SessionCookieOptions {
  readonly secure: boolean;
}

/**
 * Builds the `Set-Cookie` header value for a signed session: httpOnly (no
 * script access), SameSite=Lax (sent on top-level navigation, not on
 * cross-site subrequests), scoped to the whole app with Path=/, and Secure
 * whenever the request arrived over TLS.
 */
export function buildSessionCookieHeader(signedValue: string, options: SessionCookieOptions): string {
  const parts = [`${SESSION_COOKIE_NAME}=${signedValue}`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
  if (options.secure) {
    parts.push('Secure');
  }
  return parts.join('; ');
}

/** Builds the `Set-Cookie` header value that clears the session cookie on logout. */
export function buildSessionCookieClearHeader(options: SessionCookieOptions): string {
  const parts = [`${SESSION_COOKIE_NAME}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (options.secure) {
    parts.push('Secure');
  }
  return parts.join('; ');
}

/**
 * Whether the inbound request arrived over TLS. Exactly like
 * `resolveClientIp`, `X-Forwarded-Proto` is trusted only when a reverse
 * proxy is explicitly configured — otherwise any client could set it and
 * force a plaintext session cookie to be marked Secure (which would then
 * never be sent back).
 */
export function isSecureRequest(headers: HeaderMap, trustedProxy: boolean): boolean {
  if (!trustedProxy) {
    return false;
  }
  const proto = headers['x-forwarded-proto'];
  const value = Array.isArray(proto) ? proto[0] : proto;
  return value === 'https';
}

/** Reads the raw session cookie value (still signed) out of a `Cookie` header, if present. */
export function readSessionCookie(headers: HeaderMap): string | undefined {
  const cookieHeader = headers['cookie'];
  const raw = Array.isArray(cookieHeader) ? cookieHeader[0] : cookieHeader;
  if (raw === undefined) return undefined;

  for (const pair of raw.split(';')) {
    const separatorIndex = pair.indexOf('=');
    if (separatorIndex === -1) continue;
    const name = pair.slice(0, separatorIndex).trim();
    if (name === SESSION_COOKIE_NAME) {
      return pair.slice(separatorIndex + 1).trim();
    }
  }
  return undefined;
}

/** Matches `Config['admin']` field names exactly, so `server.ts` can pass `config.admin` through unchanged. */
export interface ConfiguredAdminPassword {
  readonly passwordHash: string;
  readonly passwordSalt: string;
}

export interface AdminAuthRoutesDependencies {
  readonly admin: ConfiguredAdminPassword;
  readonly sessionSecret: string;
  readonly trustedProxy: boolean;
  /**
   * A rate limiter dedicated to the login route, configured stricter than
   * the one guarding ingest: a login endpoint is a credential-guessing
   * target, not a high-volume public collector.
   */
  readonly loginRateLimiter: TokenBucketRateLimiter;
}

interface LoginBody {
  readonly password?: unknown;
}

const LOGIN_RATE_LIMIT_KEY = 'admin-login';
const SESSION_VALUE_PREFIX = 'admin-session';

/**
 * Registers the admin dashboard's login and logout routes. Login accepts
 * only the single configured admin password (hashed with scrypt, compared
 * with `timingSafeEqual`) and, on success, sets the strictly-necessary
 * session cookie described at the top of this file.
 */
export function registerAdminAuthRoutes(fastify: FastifyInstance, deps: AdminAuthRoutesDependencies): void {
  fastify.post('/api/admin/login', async (request, reply) => {
    const headers = request.headers as HeaderMap;
    const ip = resolveClientIp(headers, request.socket.remoteAddress ?? '', deps.trustedProxy);

    if (!deps.loginRateLimiter.consume(LOGIN_RATE_LIMIT_KEY, ip)) {
      return reply.code(429).send({ error: 'too_many_attempts' });
    }

    const body = (request.body ?? {}) as LoginBody;
    const password = typeof body.password === 'string' ? body.password : '';

    const storedHash: PasswordHash = { salt: deps.admin.passwordSalt, hash: deps.admin.passwordHash };
    if (password.length === 0 || !verifyPasswordHash(password, storedHash)) {
      return reply.code(401).send({ error: 'invalid_credentials' });
    }

    const secure = isSecureRequest(headers, deps.trustedProxy);
    const sessionValue = `${SESSION_VALUE_PREFIX}:${Date.now()}`;
    const signed = signSessionValue(sessionValue, deps.sessionSecret);
    reply.header('Set-Cookie', buildSessionCookieHeader(signed, { secure }));

    return reply.code(200).send({ ok: true });
  });

  fastify.post('/api/admin/logout', async (request, reply) => {
    const headers = request.headers as HeaderMap;
    const secure = isSecureRequest(headers, deps.trustedProxy);
    reply.header('Set-Cookie', buildSessionCookieClearHeader({ secure }));
    return reply.code(204).send();
  });
}

/** Whether a request carries a validly-signed admin session cookie. Used by routes that require an authenticated operator. */
export function isAuthenticatedRequest(headers: HeaderMap, sessionSecret: string): boolean {
  const cookie = readSessionCookie(headers);
  if (cookie === undefined) return false;
  const value = verifySessionValue(cookie, sessionSecret);
  return value !== undefined && value.startsWith(SESSION_VALUE_PREFIX);
}

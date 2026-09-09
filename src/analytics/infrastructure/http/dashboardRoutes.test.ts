import { test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { registerDashboardRoutes } from './dashboardRoutes.ts';
import type { QuerySiteMetricsUseCase, SiteActivityUseCase } from './dashboardRoutes.ts';
import type { SiteActivity } from '../../domain/ports/SiteActivityRepository.ts';
import { registerAdminAuthRoutes, hashPassword, SESSION_COOKIE_NAME } from './adminAuth.ts';
import { TokenBucketRateLimiter } from './rateLimit.ts';
import type { SiteId } from '../../domain/event/SiteId.ts';
import type { TimeRange } from '../../domain/report/TimeRange.ts';
import type { Breakdown, BreakdownDimension } from '../../domain/report/Breakdown.ts';
import type { MetricRow } from '../../domain/report/Metrics.ts';
import type { Locale } from '../i18n/Locale.ts';

function site(value: string): SiteId {
  return value as SiteId;
}

class FakeQuerySiteMetrics implements QuerySiteMetricsUseCase {
  readonly calls: Array<{ site: SiteId; range: TimeRange; dimension: BreakdownDimension }> = [];
  readonly #rowsByDimension: Partial<Record<BreakdownDimension, readonly MetricRow[]>>;

  constructor(rowsByDimension: Partial<Record<BreakdownDimension, readonly MetricRow[]>> = {}) {
    this.#rowsByDimension = rowsByDimension;
  }

  async execute(siteId: SiteId, range: TimeRange, breakdown: Breakdown): Promise<readonly MetricRow[]> {
    this.calls.push({ site: siteId, range, dimension: breakdown.dimension });
    return this.#rowsByDimension[breakdown.dimension] ?? [];
  }
}

class FakeSiteActivity implements SiteActivityUseCase {
  readonly calls: SiteId[] = [];
  readonly #activityBySite: Partial<Record<SiteId, SiteActivity>>;

  constructor(activityBySite: Partial<Record<SiteId, SiteActivity>> = {}) {
    this.#activityBySite = activityBySite;
  }

  async activityFor(siteId: SiteId): Promise<SiteActivity> {
    this.calls.push(siteId);
    return this.#activityBySite[siteId] ?? { totalEvents: 0, lastEventTs: null };
  }
}

interface BuildAppOptions {
  readonly password?: string;
  readonly sites?: readonly SiteId[];
  readonly querySiteMetrics?: QuerySiteMetricsUseCase;
  readonly siteActivity?: SiteActivityUseCase;
  readonly loginCapacity?: number;
  readonly trustedProxy?: boolean;
  readonly now?: Date;
  readonly withJsonLogin?: boolean;
  readonly configuredLocale?: Locale;
}

function buildApp(options: BuildAppOptions = {}): { fastify: FastifyInstance; passwordUsed: string } {
  const password = options.password ?? 'a-real-admin-password';
  const admin = hashPassword(password);
  const fastify = Fastify();
  const loginRateLimiter = new TokenBucketRateLimiter({ capacity: options.loginCapacity ?? 5, refillPerMinute: 5 });

  if (options.withJsonLogin ?? false) {
    registerAdminAuthRoutes(fastify, {
      admin: { passwordHash: admin.hash, passwordSalt: admin.salt },
      sessionSecret: 'test-session-secret',
      trustedProxy: options.trustedProxy ?? false,
      loginRateLimiter: new TokenBucketRateLimiter({ capacity: 5, refillPerMinute: 5 }),
    });
  }

  registerDashboardRoutes(fastify, {
    sites: options.sites ?? [site('example.com')],
    admin: { passwordHash: admin.hash, passwordSalt: admin.salt },
    sessionSecret: 'test-session-secret',
    trustedProxy: options.trustedProxy ?? false,
    loginRateLimiter,
    querySiteMetrics: options.querySiteMetrics ?? new FakeQuerySiteMetrics(),
    siteActivity: options.siteActivity ?? new FakeSiteActivity(),
    ...(options.now !== undefined ? { clock: { now: () => options.now as Date } } : {}),
    ...(options.configuredLocale !== undefined ? { configuredLocale: options.configuredLocale } : {}),
  });

  return { fastify, passwordUsed: password };
}

async function loginAndGetCookie(fastify: FastifyInstance, password: string): Promise<string> {
  const response = await fastify.inject({
    method: 'POST',
    url: '/login',
    payload: `password=${encodeURIComponent(password)}`,
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  });
  const cookie = response.headers['set-cookie'];
  assert.ok(cookie, 'expected /login to set a session cookie');
  const cookieHeader = String(cookie).split(';')[0];
  assert.ok(cookieHeader);
  return cookieHeader as string;
}

test('GET / redirects to /login when unauthenticated', async () => {
  const { fastify } = buildApp();
  const response = await fastify.inject({ method: 'GET', url: '/' });
  assert.equal(response.statusCode, 302);
  assert.equal(response.headers['location'], '/login');
});

test('GET / redirects to /dashboard when authenticated', async () => {
  const { fastify, passwordUsed } = buildApp();
  const cookie = await loginAndGetCookie(fastify, passwordUsed);
  const response = await fastify.inject({ method: 'GET', url: '/', headers: { cookie } });
  assert.equal(response.statusCode, 302);
  assert.equal(response.headers['location'], '/dashboard');
});

test('GET /login renders the login form when unauthenticated', async () => {
  const { fastify } = buildApp();
  const response = await fastify.inject({ method: 'GET', url: '/login' });
  assert.equal(response.statusCode, 200);
  assert.match(response.payload, /<form method="post" action="\/login"/);
});

test('GET /login redirects to /dashboard instead of showing the form again when already authenticated', async () => {
  const { fastify, passwordUsed } = buildApp();
  const cookie = await loginAndGetCookie(fastify, passwordUsed);
  const response = await fastify.inject({ method: 'GET', url: '/login', headers: { cookie } });
  assert.equal(response.statusCode, 302);
  assert.equal(response.headers['location'], '/dashboard');
});

test('POST /login with the correct password sets a session cookie and 303-redirects to /dashboard', async () => {
  const { fastify, passwordUsed } = buildApp();
  const response = await fastify.inject({
    method: 'POST',
    url: '/login',
    payload: `password=${encodeURIComponent(passwordUsed)}`,
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  });
  assert.equal(response.statusCode, 303);
  assert.equal(response.headers['location'], '/dashboard');
  assert.ok(response.headers['set-cookie']);
  assert.match(String(response.headers['set-cookie']), new RegExp(`^${SESSION_COOKIE_NAME}=`));
});

test('POST /login with the wrong password re-renders the form with one generic message and no cookie', async () => {
  const { fastify } = buildApp();
  const response = await fastify.inject({
    method: 'POST',
    url: '/login',
    payload: 'password=totally-wrong',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  });
  assert.notEqual(response.statusCode, 303);
  assert.equal(response.headers['set-cookie'], undefined);
  assert.match(response.payload, /<form method="post" action="\/login"/);
});

test('POST /login shows the exact same generic message whether the password was wrong or the rate limit was exhausted', async () => {
  const { fastify } = buildApp({ loginCapacity: 1 });
  const wrongPasswordResponse = await fastify.inject({
    method: 'POST',
    url: '/login',
    payload: 'password=wrong-once',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  });

  const rateLimitedResponse = await fastify.inject({
    method: 'POST',
    url: '/login',
    payload: 'password=wrong-again',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  });

  assert.notEqual(rateLimitedResponse.statusCode, 303);
  assert.equal(rateLimitedResponse.headers['set-cookie'], undefined);

  function extractMessage(payload: string): string | undefined {
    const match = /<p class="error">([^<]*)<\/p>/.exec(payload);
    return match?.[1];
  }

  const wrongMessage = extractMessage(wrongPasswordResponse.payload);
  const rateLimitedMessage = extractMessage(rateLimitedResponse.payload);
  assert.ok(wrongMessage);
  assert.ok(rateLimitedMessage);
  assert.equal(wrongMessage, rateLimitedMessage);
});

test('POST /logout without a session redirects to /login', async () => {
  const { fastify } = buildApp();
  const response = await fastify.inject({ method: 'POST', url: '/logout' });
  assert.equal(response.statusCode, 303);
  assert.equal(response.headers['location'], '/login');
});

test('POST /logout with a valid session clears the cookie and redirects to /login', async () => {
  const { fastify, passwordUsed } = buildApp();
  const cookie = await loginAndGetCookie(fastify, passwordUsed);
  const response = await fastify.inject({ method: 'POST', url: '/logout', headers: { cookie } });
  assert.equal(response.statusCode, 303);
  assert.equal(response.headers['location'], '/login');
  assert.match(String(response.headers['set-cookie']), /Max-Age=0/);
});

test('GET /dashboard without a session redirects to /login', async () => {
  const { fastify } = buildApp();
  const response = await fastify.inject({ method: 'GET', url: '/dashboard' });
  assert.equal(response.statusCode, 302);
  assert.equal(response.headers['location'], '/login');
});

test('GET /dashboard lists every configured site with a copyable snippet built from the request Host header', async () => {
  const { fastify, passwordUsed } = buildApp({ sites: [site('one.example'), site('two.example')] });
  const cookie = await loginAndGetCookie(fastify, passwordUsed);
  const response = await fastify.inject({
    method: 'GET',
    url: '/dashboard',
    headers: { cookie, host: 'admin.example.com' },
  });
  assert.equal(response.statusCode, 200);
  assert.match(response.payload, /one\.example/);
  assert.match(response.payload, /two\.example/);
  assert.match(response.payload, /admin\.example\.com\/t\.js/);
  assert.match(response.payload, /admin\.example\.com\/t\.gif/);
});

test('GET /dashboard shows an honest activity line for a site that has never received an event', async () => {
  const { fastify, passwordUsed } = buildApp({ sites: [site('never-visited.example')] });
  const cookie = await loginAndGetCookie(fastify, passwordUsed);
  const response = await fastify.inject({ method: 'GET', url: '/dashboard', headers: { cookie } });
  assert.equal(response.statusCode, 200);
  assert.match(response.payload, /no events received yet/i);
  assert.match(response.payload, /tracking snippet is installed/i);
  assert.match(response.payload, /domain matches exactly/i);
});

test('GET /dashboard shows the relative time of the last event and the total count for a site with events', async () => {
  const activeSite = site('active.example');
  const now = new Date('2026-01-07T12:00:00Z');
  const lastEventTs = Math.floor(now.getTime() / 1000) - 120; // 2 minutes ago
  const siteActivity = new FakeSiteActivity({ [activeSite]: { totalEvents: 42, lastEventTs } });
  const { fastify, passwordUsed } = buildApp({ sites: [activeSite], siteActivity, now });
  const cookie = await loginAndGetCookie(fastify, passwordUsed);

  const response = await fastify.inject({ method: 'GET', url: '/dashboard', headers: { cookie } });

  assert.equal(response.statusCode, 200);
  assert.match(response.payload, /2 minutes ago/);
  assert.match(response.payload, /42/);
});

test('GET /dashboard renders an activity line for every configured site', async () => {
  const siteA = site('a.example');
  const siteB = site('b.example');
  const now = new Date('2026-01-07T12:00:00Z');
  const siteActivity = new FakeSiteActivity({
    [siteA]: { totalEvents: 3, lastEventTs: Math.floor(now.getTime() / 1000) - 3_600 },
  });
  const { fastify, passwordUsed } = buildApp({ sites: [siteA, siteB], siteActivity, now });
  const cookie = await loginAndGetCookie(fastify, passwordUsed);

  const response = await fastify.inject({ method: 'GET', url: '/dashboard', headers: { cookie } });

  assert.equal(response.statusCode, 200);
  assert.equal(siteActivity.calls.length, 2);
  assert.match(response.payload, /1 hour ago/); // siteA, has events
  assert.match(response.payload, /no events received yet/i); // siteB, never seen
});

test('GET /dashboard/:site checks authentication before revealing whether the site exists (anonymous caller learns nothing)', async () => {
  const { fastify } = buildApp({ sites: [site('example.com')] });
  const response = await fastify.inject({ method: 'GET', url: '/dashboard/not-a-configured-site' });
  assert.equal(response.statusCode, 302);
  assert.equal(response.headers['location'], '/login');
});

test('GET /dashboard/:site responds 404 with a generic page for an unconfigured site once authenticated', async () => {
  const { fastify, passwordUsed } = buildApp({ sites: [site('example.com')] });
  const cookie = await loginAndGetCookie(fastify, passwordUsed);
  const response = await fastify.inject({
    method: 'GET',
    url: '/dashboard/not-configured.example',
    headers: { cookie },
  });
  assert.equal(response.statusCode, 404);
  assert.doesNotMatch(response.payload, /example\.com/); // must not leak which sites *are* configured
});

test('GET /dashboard/:site computes headline totals from the device breakdown, never by summing the path breakdown', async () => {
  const querySiteMetrics = new FakeQuerySiteMetrics({
    device: [{ key: 'desktop', visitors: 5, pageviews: 8, sessions: 5, bounces: 1, engagementSeconds: 300 }],
    path: [
      { key: '/a', visitors: 3, pageviews: 3, sessions: 3, bounces: 0, engagementSeconds: 90 },
      { key: '/b', visitors: 4, pageviews: 4, sessions: 4, bounces: 0, engagementSeconds: 90 },
    ],
  });
  const { fastify, passwordUsed } = buildApp({
    querySiteMetrics,
    now: new Date('2026-01-07T12:00:00Z'),
  });
  const cookie = await loginAndGetCookie(fastify, passwordUsed);
  const response = await fastify.inject({
    method: 'GET',
    url: '/dashboard/example.com?range=today',
    headers: { cookie },
  });

  assert.equal(response.statusCode, 200);
  // Headline visitors must be 5 (the exact device-breakdown count), never 7
  // (the naive, inflated sum across the path breakdown's rows).
  assert.match(response.payload, /<span class="value">5<\/span>\s*<div class="label">Visitors<\/div>/);
  assert.match(response.payload, /\/a/);
  assert.match(response.payload, /\/b/);
});

test('GET /dashboard/:site?range=today reuses the headline device query for the single-day chart point instead of querying twice', async () => {
  const querySiteMetrics = new FakeQuerySiteMetrics({
    device: [{ key: 'desktop', visitors: 2, pageviews: 2, sessions: 2, bounces: 0, engagementSeconds: 60 }],
  });
  const { fastify, passwordUsed } = buildApp({ querySiteMetrics, now: new Date('2026-01-07T12:00:00Z') });
  const cookie = await loginAndGetCookie(fastify, passwordUsed);

  const response = await fastify.inject({
    method: 'GET',
    url: '/dashboard/example.com?range=today',
    headers: { cookie },
  });
  assert.equal(response.statusCode, 200);

  const deviceCalls = querySiteMetrics.calls.filter((call) => call.dimension === 'device');
  assert.equal(deviceCalls.length, 1, 'expected exactly one device-breakdown query for a 1-day range');

  const dimensionsQueried = new Set(querySiteMetrics.calls.map((call) => call.dimension));
  assert.equal(dimensionsQueried.size, 7, 'expected each of the 7 breakdown dimensions to be queried exactly once');
});

test('GET /dashboard/:site with the default 7d range queries the device breakdown once per day for the chart, plus once for the full-range headline', async () => {
  const querySiteMetrics = new FakeQuerySiteMetrics();
  const { fastify, passwordUsed } = buildApp({ querySiteMetrics, now: new Date('2026-01-07T12:00:00Z') });
  const cookie = await loginAndGetCookie(fastify, passwordUsed);

  const response = await fastify.inject({ method: 'GET', url: '/dashboard/example.com', headers: { cookie } });
  assert.equal(response.statusCode, 200);

  const deviceCalls = querySiteMetrics.calls.filter((call) => call.dimension === 'device');
  // 1 full-range call for headline totals + 7 single-day calls for the chart.
  assert.equal(deviceCalls.length, 8);
});

test('GET /dashboard/:site falls back to the 7d default for an unrecognized range value instead of erroring', async () => {
  const { fastify, passwordUsed } = buildApp({ now: new Date('2026-01-07T12:00:00Z') });
  const cookie = await loginAndGetCookie(fastify, passwordUsed);
  const response = await fastify.inject({
    method: 'GET',
    url: '/dashboard/example.com?range=nonsense',
    headers: { cookie },
  });
  assert.equal(response.statusCode, 200);
});

test('GET /dashboard/:site shows an honest empty state when there is no data at all', async () => {
  const { fastify, passwordUsed } = buildApp({ now: new Date('2026-01-07T12:00:00Z') });
  const cookie = await loginAndGetCookie(fastify, passwordUsed);
  const response = await fastify.inject({ method: 'GET', url: '/dashboard/example.com', headers: { cookie } });
  assert.equal(response.statusCode, 200);
  assert.match(response.payload, /check that the tracking snippet is installed/i);
});

test('a session created via the JSON /api/admin/login route is accepted by the HTML dashboard routes', async () => {
  const { fastify, passwordUsed } = buildApp({ withJsonLogin: true, now: new Date('2026-01-07T12:00:00Z') });
  const jsonLoginResponse = await fastify.inject({
    method: 'POST',
    url: '/api/admin/login',
    payload: { password: passwordUsed },
  });
  assert.equal(jsonLoginResponse.statusCode, 200);
  const cookie = String(jsonLoginResponse.headers['set-cookie']).split(';')[0];

  const dashboardResponse = await fastify.inject({ method: 'GET', url: '/dashboard', headers: { cookie } });
  assert.equal(dashboardResponse.statusCode, 200);
});

test('every dashboard response carries the required security headers', async () => {
  const { fastify } = buildApp();
  const response = await fastify.inject({ method: 'GET', url: '/login' });
  assert.equal(
    response.headers['content-security-policy'],
    "default-src 'none'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; form-action 'self'; frame-ancestors 'none'",
  );
  assert.equal(response.headers['x-content-type-options'], 'nosniff');
  assert.equal(response.headers['referrer-policy'], 'same-origin');
});

test('the security headers are present on a redirect response too', async () => {
  const { fastify } = buildApp();
  const response = await fastify.inject({ method: 'GET', url: '/' });
  assert.equal(response.headers['x-content-type-options'], 'nosniff');
  assert.equal(response.headers['referrer-policy'], 'same-origin');
});

test('the security headers are present on the 404 response', async () => {
  const { fastify, passwordUsed } = buildApp({ sites: [site('example.com')] });
  const cookie = await loginAndGetCookie(fastify, passwordUsed);
  const response = await fastify.inject({
    method: 'GET',
    url: '/dashboard/not-configured.example',
    headers: { cookie },
  });
  assert.equal(response.headers['x-content-type-options'], 'nosniff');
  assert.equal(response.headers['referrer-policy'], 'same-origin');
});

test('every rendered page links to the project repository and shows the running version (AGPL network clause)', async () => {
  const { fastify } = buildApp();
  const response = await fastify.inject({ method: 'GET', url: '/login' });
  assert.match(response.payload, /<footer>/);
  assert.match(response.payload, /0\.1\.0/);
});

test('with no configured locale and no Accept-Language, the dashboard defaults to English', async () => {
  const { fastify } = buildApp();
  const response = await fastify.inject({ method: 'GET', url: '/login' });
  assert.match(response.payload, /<html lang="en">/);
  assert.match(response.payload, /<h1>Tadoru admin<\/h1>/);
});

test('the operator\'s configured locale (TADORU_LANG) is used', async () => {
  const { fastify } = buildApp({ configuredLocale: 'ja' });
  const response = await fastify.inject({ method: 'GET', url: '/login' });
  assert.match(response.payload, /<html lang="ja">/);
  assert.match(response.payload, /<h1>Tadoru 管理画面<\/h1>/);
});

test('the configured locale wins over Accept-Language', async () => {
  const { fastify } = buildApp({ configuredLocale: 'ja' });
  const response = await fastify.inject({
    method: 'GET',
    url: '/login',
    headers: { 'accept-language': 'es' },
  });
  assert.match(response.payload, /<html lang="ja">/);
});

test('Accept-Language negotiates a language when nothing else is set', async () => {
  const { fastify } = buildApp();
  const response = await fastify.inject({
    method: 'GET',
    url: '/login',
    headers: { 'accept-language': 'en-GB,en;q=0.9,es;q=0.8' },
  });
  // "en-GB" resolves to the supported "en" primary subtag and outranks "es".
  assert.match(response.payload, /<html lang="en">/);

  const spanishPreferred = await fastify.inject({
    method: 'GET',
    url: '/login',
    headers: { 'accept-language': 'es-ES,en;q=0.5' },
  });
  assert.match(spanishPreferred.payload, /<html lang="es">/);
});

test('a malformed Accept-Language header never breaks the response, and falls back to English', async () => {
  const { fastify } = buildApp();
  const response = await fastify.inject({
    method: 'GET',
    url: '/login',
    headers: { 'accept-language': ',,,;q=;garbage' },
  });
  assert.equal(response.statusCode, 200);
  assert.match(response.payload, /<html lang="en">/);
});

test('the sites page, the overview page and the 404 page are all translated', async () => {
  const { fastify, passwordUsed } = buildApp({ sites: [site('example.com')], configuredLocale: 'es' });
  const cookie = await loginAndGetCookie(fastify, passwordUsed);

  const sitesPage = await fastify.inject({ method: 'GET', url: '/dashboard', headers: { cookie } });
  assert.match(sitesPage.payload, /<h1>Sitios<\/h1>/);

  const overviewPage = await fastify.inject({
    method: 'GET',
    url: '/dashboard/example.com',
    headers: { cookie },
  });
  assert.match(overviewPage.payload, /Todos los sitios/);

  const notFoundPage = await fastify.inject({
    method: 'GET',
    url: '/dashboard/not-configured.example',
    headers: { cookie },
  });
  assert.equal(notFoundPage.statusCode, 404);
  assert.match(notFoundPage.payload, /<h1>No encontrado<\/h1>/);
});

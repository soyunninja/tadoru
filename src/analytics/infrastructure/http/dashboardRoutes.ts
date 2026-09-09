import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { findPackageRoot } from '../packageRoot.ts';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { HeaderMap } from './requestContext.ts';
import { resolveClientIp } from './requestContext.ts';
import type { TokenBucketRateLimiter } from './rateLimit.ts';
import type { ConfiguredAdminPassword } from './adminAuth.ts';
import {
  isAuthenticatedRequest,
  verifyPasswordHash,
  signSessionValue,
  buildSessionCookieHeader,
  buildSessionCookieClearHeader,
  isSecureRequest,
} from './adminAuth.ts';
import type { PasswordHash } from './adminAuth.ts';
import type { SiteId } from '../../domain/event/SiteId.ts';
import type { Clock } from '../../domain/ports/Clock.ts';
import type { TimeRange } from '../../domain/report/TimeRange.ts';
import { dayStart, daysInRange, SECONDS_PER_DAY } from '../../domain/report/TimeRange.ts';
import type { Breakdown, BreakdownDimension } from '../../domain/report/Breakdown.ts';
import { createBreakdown } from '../../domain/report/Breakdown.ts';
import type { MetricRow } from '../../domain/report/Metrics.ts';
import type { SiteActivity } from '../../domain/ports/SiteActivityRepository.ts';
import { html } from './views/escapeHtml.ts';
import type { SafeHtml } from './views/escapeHtml.ts';
import { renderLayout, DEFAULT_REPOSITORY_URL } from './views/layout.ts';
import { renderLoginPage } from './views/loginPage.ts';
import type { RangeKey } from './views/overviewPage.ts';
import { renderOverviewPage } from './views/overviewPage.ts';
import { sumMetricRows, renderLogoutForm, renderTrackingSnippet } from './views/components.ts';
import type { Locale } from '../i18n/Locale.ts';
import { resolveLocale } from '../i18n/Locale.ts';
import { messagesFor } from '../i18n/messages.ts';
import { formatNumber, formatRelativeTime } from '../i18n/format.ts';

/**
 * The narrow surface `dashboardRoutes` needs from `QuerySiteMetrics`.
 * Depending on this instead of the concrete class keeps the route handlers
 * trivially testable with an in-memory fake — the same pattern
 * `collectRoutes.ts` uses for `RecordEventUseCase`.
 */
export interface QuerySiteMetricsUseCase {
  execute(site: SiteId, range: TimeRange, breakdown: Breakdown): Promise<readonly MetricRow[]>;
}

/**
 * The narrow surface `dashboardRoutes` needs to answer "has this site ever
 * received an event" — structurally identical to the `SiteActivityRepository`
 * driven port (see domain/ports/SiteActivityRepository.ts), named locally the
 * same way `QuerySiteMetricsUseCase` mirrors `MetricsRepository` above.
 */
export interface SiteActivityUseCase {
  activityFor(site: SiteId): Promise<SiteActivity>;
}

export interface DashboardRoutesDependencies {
  readonly sites: readonly SiteId[];
  readonly admin: ConfiguredAdminPassword;
  readonly sessionSecret: string;
  readonly trustedProxy: boolean;
  /** Dedicated to the HTML login route — a credential-guessing target, configured stricter than ingest, same as `AdminAuthRoutesDependencies.loginRateLimiter`. */
  readonly loginRateLimiter: TokenBucketRateLimiter;
  readonly querySiteMetrics: QuerySiteMetricsUseCase;
  /** Optional so an installation that hasn't wired the adapter yet still renders — every site simply reports as never having received an event. */
  readonly siteActivity?: SiteActivityUseCase;
  readonly clock?: Clock;
  /** The operator's `TADORU_LANG` setting (see `loadConfig.ts`), if configured. Wins over `Accept-Language` negotiation. */
  readonly configuredLocale?: Locale;
}

const DEFAULT_CLOCK: Clock = { now: () => new Date() };

const DEFAULT_SITE_ACTIVITY: SiteActivityUseCase = {
  activityFor: () => Promise.resolve({ totalEvents: 0, lastEventTs: null }),
};

// Must match adminAuth.ts's private SESSION_VALUE_PREFIX ('admin-session')
// exactly: that constant is not exported, so a session created by either
// route module has to use the same literal prefix by convention for
// isAuthenticatedRequest (which only checks the prefix) to accept both.
const SESSION_VALUE_PREFIX = 'admin-session';

const DASHBOARD_LOGIN_RATE_LIMIT_KEY = 'dashboard-login';

const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'Content-Security-Policy':
    "default-src 'none'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; form-action 'self'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
};

interface PackageJsonMetadataShape {
  readonly version?: unknown;
  readonly homepage?: unknown;
  readonly repository?: unknown;
}

interface PackageMetadata {
  readonly version: string;
  readonly repositoryUrl: string;
}

/**
 * Reads `version` and a "corresponding source" URL from package.json once at
 * module load (AGENTS.md invariant 10 / docs/adr/0006-agpl-and-the-network
 * -clause.md): every dashboard page's footer must link to the repository
 * and show the exact running version, so it can never drift from a
 * hardcoded literal. Falls back to a placeholder repository URL if
 * package.json carries neither `homepage` nor `repository.url` — see
 * `views/layout.ts`'s `DEFAULT_REPOSITORY_URL` for that placeholder.
 */
function readPackageMetadata(): PackageMetadata {
  try {
    // Resolved by walking up rather than by a fixed depth: the published tree
    // nests these modules one level deeper than the development tree, so a
    // literal '../../../../' lands on dist/ once installed and finds nothing.
    const packageRoot = findPackageRoot(import.meta.url);
    if (packageRoot === null) return { version: '0.0.0', repositoryUrl: DEFAULT_REPOSITORY_URL };
    const raw = readFileSync(join(packageRoot, 'package.json'), 'utf8');
    const parsed = JSON.parse(raw) as PackageJsonMetadataShape;

    const version = typeof parsed.version === 'string' ? parsed.version : '0.0.0';

    let repositoryUrl = DEFAULT_REPOSITORY_URL;
    if (typeof parsed.homepage === 'string' && parsed.homepage.length > 0) {
      repositoryUrl = parsed.homepage;
    } else if (
      typeof parsed.repository === 'object' &&
      parsed.repository !== null &&
      typeof (parsed.repository as { url?: unknown }).url === 'string'
    ) {
      repositoryUrl = (parsed.repository as { url: string }).url.replace(/^git\+/, '').replace(/\.git$/, '');
    } else if (typeof parsed.repository === 'string' && parsed.repository.length > 0) {
      repositoryUrl = parsed.repository;
    }

    return { version, repositoryUrl };
  } catch {
    return { version: '0.0.0', repositoryUrl: DEFAULT_REPOSITORY_URL };
  }
}

const PACKAGE_METADATA = readPackageMetadata();

function firstHeaderValue(value: string | readonly string[] | undefined): string | undefined {
  if (value === undefined) return undefined;
  return typeof value === 'string' ? value : value[0];
}

function requestHeaders(request: FastifyRequest): HeaderMap {
  return request.headers as HeaderMap;
}

/**
 * Resolves the language for one request, per specs/dashboard/spec.md's i18n
 * change: the operator's `TADORU_LANG` (`deps.configuredLocale`) wins, then
 * `Accept-Language` negotiation, then English.
 */
function resolveRequestLocale(request: FastifyRequest, deps: DashboardRoutesDependencies): Locale {
  return resolveLocale({
    configuredLocale: deps.configuredLocale,
    acceptLanguageHeader: firstHeaderValue(requestHeaders(request)['accept-language']),
  });
}

function sendHtml(reply: FastifyReply, statusCode: number, page: SafeHtml): FastifyReply {
  return reply.code(statusCode).type('text/html; charset=utf-8').send(page.toString());
}

function redirect(reply: FastifyReply, statusCode: number, location: string): FastifyReply {
  return reply.code(statusCode).header('Location', location).send();
}

const RANGE_KEYS: readonly RangeKey[] = ['today', '7d', '30d', '12m'];

function parseRangeKey(raw: string | undefined): RangeKey {
  return (RANGE_KEYS as readonly string[]).includes(raw ?? '') ? (raw as RangeKey) : '7d';
}

/** Builds the UTC day-aligned TimeRange for a range key, ending at "now" (inclusive of today). */
function buildTimeRange(range: RangeKey, nowSeconds: number): TimeRange {
  const todayStart = dayStart(nowSeconds);
  const endTs = todayStart + SECONDS_PER_DAY;
  const trailingDays: Readonly<Record<RangeKey, number>> = { today: 1, '7d': 7, '30d': 30, '12m': 365 };
  const startTs = todayStart - (trailingDays[range] - 1) * SECONDS_PER_DAY;
  return { startTs, endTs };
}

function isoDateFromDayStart(dayStartSeconds: number): string {
  const isoString = new Date(dayStartSeconds * 1000).toISOString();
  return isoString.slice(0, 10);
}

/** All seven breakdown dimensions always exist in BREAKDOWN_DIMENSIONS, so createBreakdown never fails for these fixed literals. */
function fixedBreakdown(dimension: BreakdownDimension): Breakdown {
  const result = createBreakdown(dimension);
  if (!result.ok) {
    throw new Error(`unreachable: "${dimension}" is a fixed valid breakdown dimension`);
  }
  return result.value;
}

/**
 * Renders the "is it actually working" line for one site: whether anything
 * has ever arrived, and if so when the last event landed and how many there
 * have been in total. A site with no traffic yet is the normal first state
 * for a freshly configured site, not an error, so it gets guidance rather
 * than a blank.
 */
function renderSiteActivityLine(activity: SiteActivity, nowSeconds: number, locale: Locale): SafeHtml {
  const messages = messagesFor(locale);
  if (activity.lastEventTs === null) {
    return html`${messages.sites.activityNever}`;
  }
  const lastSeen = formatRelativeTime(activity.lastEventTs, nowSeconds, locale);
  const totalEvents = formatNumber(activity.totalEvents, locale);
  return html`${messages.sites.activitySummary(lastSeen, totalEvents)}`;
}

function renderSitesPage(options: {
  readonly sites: readonly SiteId[];
  readonly host: string;
  readonly secure: boolean;
  readonly locale: Locale;
  readonly nowSeconds: number;
  readonly activityBySite: ReadonlyMap<SiteId, SiteActivity>;
}): SafeHtml {
  const messages = messagesFor(options.locale);
  const items = options.sites.map((siteId) => {
    const activity = options.activityBySite.get(siteId) ?? { totalEvents: 0, lastEventTs: null };
    return html`<li>
  <h2><a href="/dashboard/${siteId}">${siteId}</a></h2>
  <p class="muted">${renderSiteActivityLine(activity, options.nowSeconds, options.locale)}</p>
  ${renderTrackingSnippet(options.host, options.secure)}
</li>`;
  });

  const listOrEmpty =
    options.sites.length === 0
      ? html`<p class="muted">${messages.sites.empty}</p>`
      : html`<ul>${items}</ul>`;

  const body = html`<h1>${messages.sites.heading}</h1>
${listOrEmpty}
<p>${renderLogoutForm(options.locale)}</p>`;

  return renderLayout({
    title: messages.sites.pageTitle,
    body,
    version: PACKAGE_METADATA.version,
    repositoryUrl: PACKAGE_METADATA.repositoryUrl,
    locale: options.locale,
  });
}

function renderNotFoundPage(locale: Locale): SafeHtml {
  const messages = messagesFor(locale);
  const body = html`<h1>${messages.notFound.heading}</h1>
<p>${messages.notFound.body} <a href="/dashboard">${messages.notFound.backLink}</a>.</p>`;
  return renderLayout({
    title: messages.notFound.pageTitle,
    body,
    version: PACKAGE_METADATA.version,
    repositoryUrl: PACKAGE_METADATA.repositoryUrl,
    locale,
  });
}

/**
 * Registers the server-rendered admin dashboard: login/logout (plain HTML
 * forms, no JS — the CSP forbids scripts entirely) and the site overview
 * pages. Every response gets the three required security headers via a
 * scoped `onSend` hook, and a dedicated content-type parser is registered
 * for `application/x-www-form-urlencoded` bodies (Fastify's default parser
 * only understands JSON).
 */
export function registerDashboardRoutes(fastify: FastifyInstance, deps: DashboardRoutesDependencies): void {
  const clock = deps.clock ?? DEFAULT_CLOCK;

  fastify.register(async (scoped) => {
    scoped.addHook('onSend', async (_request, reply, payload) => {
      for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
        reply.header(name, value);
      }
      return payload;
    });

    scoped.addContentTypeParser(
      'application/x-www-form-urlencoded',
      { parseAs: 'string' },
      (_request, body, done) => {
        try {
          done(null, Object.fromEntries(new URLSearchParams(body as string)));
        } catch (error) {
          done(error as Error, undefined);
        }
      },
    );

    scoped.get('/', async (request, reply) => {
      const authenticated = isAuthenticatedRequest(requestHeaders(request), deps.sessionSecret);
      return redirect(reply, 302, authenticated ? '/dashboard' : '/login');
    });

    scoped.get('/login', async (request, reply) => {
      if (isAuthenticatedRequest(requestHeaders(request), deps.sessionSecret)) {
        return redirect(reply, 302, '/dashboard');
      }
      const locale = resolveRequestLocale(request, deps);
      return sendHtml(
        reply,
        200,
        renderLoginPage({
          version: PACKAGE_METADATA.version,
          repositoryUrl: PACKAGE_METADATA.repositoryUrl,
          locale,
        }),
      );
    });

    scoped.post('/login', async (request, reply) => {
      const headers = requestHeaders(request);
      const ip = resolveClientIp(headers, request.socket.remoteAddress ?? '', deps.trustedProxy);
      const locale = resolveRequestLocale(request, deps);

      const failWithGenericMessage = () =>
        sendHtml(
          reply,
          401,
          renderLoginPage({
            version: PACKAGE_METADATA.version,
            repositoryUrl: PACKAGE_METADATA.repositoryUrl,
            locale,
            error: messagesFor(locale).login.genericError,
          }),
        );

      if (!deps.loginRateLimiter.consume(DASHBOARD_LOGIN_RATE_LIMIT_KEY, ip)) {
        return failWithGenericMessage();
      }

      const body = (request.body ?? {}) as { password?: unknown };
      const password = typeof body.password === 'string' ? body.password : '';
      const storedHash: PasswordHash = { salt: deps.admin.passwordSalt, hash: deps.admin.passwordHash };

      if (password.length === 0 || !verifyPasswordHash(password, storedHash)) {
        return failWithGenericMessage();
      }

      const secure = isSecureRequest(headers, deps.trustedProxy);
      const sessionValue = `${SESSION_VALUE_PREFIX}:${clock.now().getTime()}`;
      const signed = signSessionValue(sessionValue, deps.sessionSecret);
      reply.header('Set-Cookie', buildSessionCookieHeader(signed, { secure }));
      return redirect(reply, 303, '/dashboard');
    });

    scoped.post('/logout', async (request, reply) => {
      const headers = requestHeaders(request);
      if (!isAuthenticatedRequest(headers, deps.sessionSecret)) {
        return redirect(reply, 303, '/login');
      }
      const secure = isSecureRequest(headers, deps.trustedProxy);
      reply.header('Set-Cookie', buildSessionCookieClearHeader({ secure }));
      return redirect(reply, 303, '/login');
    });

    scoped.get('/dashboard', async (request, reply) => {
      const headers = requestHeaders(request);
      if (!isAuthenticatedRequest(headers, deps.sessionSecret)) {
        return redirect(reply, 302, '/login');
      }
      const host = firstHeaderValue(headers['host']) ?? '';
      const secure = isSecureRequest(headers, deps.trustedProxy);
      const locale = resolveRequestLocale(request, deps);
      const siteActivity = deps.siteActivity ?? DEFAULT_SITE_ACTIVITY;
      const activityEntries = await Promise.all(
        deps.sites.map(async (configuredSite) => [configuredSite, await siteActivity.activityFor(configuredSite)] as const),
      );
      const activityBySite = new Map(activityEntries);
      const nowSeconds = Math.floor(clock.now().getTime() / 1000);
      return sendHtml(
        reply,
        200,
        renderSitesPage({ sites: deps.sites, host, secure, locale, nowSeconds, activityBySite }),
      );
    });

    scoped.get<{ Params: { site: string }; Querystring: { range?: string } }>(
      '/dashboard/:site',
      async (request, reply) => {
        const headers = requestHeaders(request);
        if (!isAuthenticatedRequest(headers, deps.sessionSecret)) {
          return redirect(reply, 302, '/login');
        }
        const locale = resolveRequestLocale(request, deps);

        const matchedSite = deps.sites.find((configured) => configured === request.params.site);
        if (matchedSite === undefined) {
          return sendHtml(reply, 404, renderNotFoundPage(locale));
        }

        const rangeKey = parseRangeKey(request.query.range);
        const nowSeconds = Math.floor(clock.now().getTime() / 1000);
        const range = buildTimeRange(rangeKey, nowSeconds);

        const deviceBreakdown = fixedBreakdown('device');
        const deviceRows = await deps.querySiteMetrics.execute(matchedSite, range, deviceBreakdown);
        const totals = sumMetricRows(deviceRows);

        // A literal-length tuple (rather than mapping over
        // OTHER_BREAKDOWN_DIMENSIONS and destructuring the result) keeps
        // each element's type exact under `noUncheckedIndexedAccess`.
        const [pathRows, referrerRows, countryRows, browserRows, osRows, campaignRows] = await Promise.all([
          deps.querySiteMetrics.execute(matchedSite, range, fixedBreakdown('path')),
          deps.querySiteMetrics.execute(matchedSite, range, fixedBreakdown('referrer')),
          deps.querySiteMetrics.execute(matchedSite, range, fixedBreakdown('country')),
          deps.querySiteMetrics.execute(matchedSite, range, fixedBreakdown('browser')),
          deps.querySiteMetrics.execute(matchedSite, range, fixedBreakdown('os')),
          deps.querySiteMetrics.execute(matchedSite, range, fixedBreakdown('campaign')),
        ]);

        const days = daysInRange(range);
        const dailyVisitors = await Promise.all(
          days.map(async (dayStartSeconds) => {
            // A 1-day range's single chart point is exactly the headline
            // query already made above — reuse it instead of querying twice.
            const rows =
              days.length === 1
                ? deviceRows
                : await deps.querySiteMetrics.execute(
                    matchedSite,
                    { startTs: dayStartSeconds, endTs: dayStartSeconds + SECONDS_PER_DAY },
                    deviceBreakdown,
                  );
            return { date: isoDateFromDayStart(dayStartSeconds), visitors: sumMetricRows(rows).visitors };
          }),
        );

        const page = renderOverviewPage({
          site: matchedSite,
          range: rangeKey,
          totals,
          dailyVisitors,
          breakdowns: {
            path: pathRows,
            referrer: referrerRows,
            country: countryRows,
            device: deviceRows,
            browser: browserRows,
            os: osRows,
            campaign: campaignRows,
          },
          version: PACKAGE_METADATA.version,
          repositoryUrl: PACKAGE_METADATA.repositoryUrl,
          locale,
        });

        return sendHtml(reply, 200, page);
      },
    );
  });
}

import type { FastifyBaseLogger, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Result } from '../../../shared/Result.ts';
import type { RecordEventInput, RecordEventError } from '../../application/RecordEvent.ts';
import type { TrackedEvent } from '../../domain/event/TrackedEvent.ts';
import { resolveClientIp, resolveSiteHeader } from './requestContext.ts';
import type { HeaderMap } from './requestContext.ts';
import type { TokenBucketRateLimiter } from './rateLimit.ts';

/**
 * The narrow surface `collectRoutes` needs from `RecordEvent`. Depending on
 * this instead of the concrete class keeps the route handlers trivially
 * testable with an in-memory fake.
 */
export interface RecordEventUseCase {
  execute(input: RecordEventInput): Promise<Result<TrackedEvent, RecordEventError>>;
}

export interface CollectRoutesDependencies {
  readonly recordEvent: RecordEventUseCase;
  readonly trustedProxy: boolean;
  readonly rateLimiter: TokenBucketRateLimiter;
}

// A single-frame, fully transparent 1x1 GIF, embedded once at module load
// rather than read from disk on every request.
const TRANSPARENT_GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==', 'base64');

const MAX_EVENT_BODY_BYTES = 8 * 1024;

interface EventBody {
  readonly type?: unknown;
  readonly path?: unknown;
  readonly referrer?: unknown;
  readonly name?: unknown;
  readonly props?: unknown;
  readonly value?: unknown;
  readonly screenWidth?: unknown;
  readonly screenBucket?: unknown;
  readonly colorScheme?: unknown;
  readonly lang?: unknown;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function asProps(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function setNoCacheHeaders(reply: FastifyReply): void {
  reply.header('Cache-Control', 'no-store, no-cache, must-revalidate');
  reply.header('Pragma', 'no-cache');
  reply.header('Expires', '0');
}

/**
 * Echoes the requesting origin back rather than using a wildcard, so this
 * never has to choose between CORS and credentialed requests: a wildcard
 * origin combined with credentials is forbidden by the CORS spec, and
 * these endpoints are cookieless anyway.
 */
function applyCors(request: FastifyRequest, reply: FastifyReply, methods: string): void {
  const origin = request.headers['origin'];
  if (typeof origin === 'string' && origin.length > 0) {
    reply.header('Access-Control-Allow-Origin', origin);
    reply.header('Vary', 'Origin');
  }
  reply.header('Access-Control-Allow-Methods', methods);
  reply.header('Access-Control-Allow-Headers', 'Content-Type');
}

function pathFromReferer(referer: string | undefined): string {
  if (referer === undefined) return '/';
  try {
    const url = new URL(referer);
    return `${url.pathname}${url.search}`;
  } catch {
    return '/';
  }
}

function requestIp(request: FastifyRequest, trustedProxy: boolean): string {
  return resolveClientIp(request.headers as HeaderMap, request.socket.remoteAddress ?? '', trustedProxy);
}

/**
 * Fires the ingestion pipeline without making the caller wait for it: ingest
 * responses must be fast and must never reveal, through timing or content,
 * whether the site was actually accepted. Errors (including "site not
 * allowed") are deliberately swallowed here — see RecordEvent for the
 * allow-list check itself.
 */
/**
 * Ingest must never make the visitor wait, and a persistence failure must never
 * reach the caller. But swallowing it outright would mean that when the database
 * starts failing, events vanish with no signal at all — so it is logged.
 */
function fireAndForget(
  recordEvent: RecordEventUseCase,
  log: FastifyBaseLogger,
  input: RecordEventInput,
): void {
  recordEvent.execute(input).catch((error: unknown) => {
    log.error({ err: error }, 'failed to record event');
  });
}

export function registerCollectRoutes(fastify: FastifyInstance, deps: CollectRoutesDependencies): void {
  fastify.options('/t.gif', async (request, reply) => {
    applyCors(request, reply, 'GET, OPTIONS');
    return reply.code(204).send();
  });

  fastify.options('/api/event', async (request, reply) => {
    applyCors(request, reply, 'POST, OPTIONS');
    return reply.code(204).send();
  });

  fastify.get('/t.gif', async (request, reply) => {
    applyCors(request, reply, 'GET, OPTIONS');
    setNoCacheHeaders(reply);
    reply.header('Content-Type', 'image/gif');

    const referer = asString((request.headers as HeaderMap)['referer']);
    const siteHeader = resolveSiteHeader(request.headers as HeaderMap);
    if (siteHeader !== undefined) {
      const ip = requestIp(request, deps.trustedProxy);
      const userAgent = asString((request.headers as HeaderMap)['user-agent']) ?? '';
      if (deps.rateLimiter.consume(siteHeader, ip)) {
        fireAndForget(deps.recordEvent, fastify.log, {
          siteHeader,
          ip,
          userAgent,
          path: pathFromReferer(referer),
          type: 'pageview',
        });
      }
    }

    return reply.code(200).send(TRANSPARENT_GIF);
  });

  fastify.post(
    '/api/event',
    { bodyLimit: MAX_EVENT_BODY_BYTES },
    async (request, reply) => {
      applyCors(request, reply, 'POST, OPTIONS');

      const siteHeader = resolveSiteHeader(request.headers as HeaderMap);
      const body = (request.body ?? {}) as EventBody;

      if (siteHeader !== undefined) {
        const ip = requestIp(request, deps.trustedProxy);
        const userAgent = asString((request.headers as HeaderMap)['user-agent']) ?? '';
        if (deps.rateLimiter.consume(siteHeader, ip)) {
          const type = asString(body.type);
          const path = asString(body.path);
          if (type !== undefined && path !== undefined) {
            const referrer = asString(body.referrer);
            const name = asString(body.name);
            const props = asProps(body.props);
            const value = asNumber(body.value);
            const screenWidth = asNumber(body.screenWidth);
            const screenBucket = asString(body.screenBucket);
            const colorScheme = asString(body.colorScheme);
            const lang = asString(body.lang);

            fireAndForget(deps.recordEvent, fastify.log, {
              siteHeader,
              ip,
              userAgent,
              path,
              type,
              ...(referrer !== undefined ? { referrer } : {}),
              ...(name !== undefined ? { name } : {}),
              ...(props !== undefined ? { props } : {}),
              ...(value !== undefined ? { value } : {}),
              ...(screenWidth !== undefined ? { screenWidth } : {}),
              ...(screenBucket !== undefined ? { screenBucket } : {}),
              ...(colorScheme !== undefined ? { colorScheme } : {}),
              ...(lang !== undefined ? { lang } : {}),
            });
          }
        }
      }

      return reply.code(204).send();
    },
  );
}

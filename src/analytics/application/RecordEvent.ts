import type { Result } from '../../shared/Result.ts';
import { ok, err } from '../../shared/Result.ts';
import { createSiteId } from '../domain/event/SiteId.ts';
import type { SiteId } from '../domain/event/SiteId.ts';
import { isEventType } from '../domain/event/EventType.ts';
import type { EventType } from '../domain/event/EventType.ts';
import { sanitizePagePath } from '../domain/event/PagePath.ts';
import { resolveReferrerSource } from '../domain/event/ReferrerSource.ts';
import { deriveVisitorId } from '../domain/event/VisitorId.ts';
import { generateSessionId, belongsToSameSession } from '../domain/event/SessionId.ts';
import { bucketScreenWidth, SCREEN_BUCKETS } from '../domain/event/ScreenBucket.ts';
import type { ScreenBucket } from '../domain/event/ScreenBucket.ts';
import { createTrackedEvent } from '../domain/event/TrackedEvent.ts';
import type { TrackedEvent } from '../domain/event/TrackedEvent.ts';
import type { Clock } from '../domain/ports/Clock.ts';
import type { SaltProvider } from '../domain/ports/SaltProvider.ts';
import type { GeoResolver } from '../domain/ports/GeoResolver.ts';
import type { DeviceResolver } from '../domain/ports/DeviceResolver.ts';
import type { EventRepository } from '../domain/ports/EventRepository.ts';

const UTM_PARAM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'] as const;

export interface RecordEventInput {
  readonly siteHeader: string;
  readonly ip: string;
  readonly userAgent: string;
  readonly path: string;
  readonly type: string;
  readonly referrer?: string;
  readonly name?: string;
  readonly props?: Record<string, unknown>;
  readonly value?: number;
  readonly screenWidth?: number;
  /**
   * A bucket already computed in the browser. Takes precedence over
   * `screenWidth` when present and valid; server-side clients that cannot
   * bucket client-side may still send a raw `screenWidth` instead.
   */
  readonly screenBucket?: string;
  readonly colorScheme?: string;
  readonly lang?: string;
}

function isScreenBucket(value: string): value is ScreenBucket {
  return (SCREEN_BUCKETS as readonly string[]).includes(value);
}

function resolveScreenBucket(input: RecordEventInput): ScreenBucket | undefined {
  if (input.screenBucket !== undefined && isScreenBucket(input.screenBucket)) {
    return input.screenBucket;
  }
  if (input.screenWidth !== undefined) {
    return bucketScreenWidth(input.screenWidth);
  }
  return undefined;
}

export type RecordEventError = 'site_not_allowed' | 'invalid_event_type';

export interface RecordEventDependencies {
  readonly clock: Clock;
  readonly saltProvider: SaltProvider;
  readonly geoResolver: GeoResolver;
  readonly deviceResolver: DeviceResolver;
  readonly eventRepository: EventRepository;
  readonly allowedSites: readonly string[];
}

function extractUtmParams(pathQuery: string): Partial<Record<(typeof UTM_PARAM_KEYS)[number], string>> {
  const queryIndex = pathQuery.indexOf('?');
  if (queryIndex === -1) return {};
  const params = new URLSearchParams(pathQuery.slice(queryIndex + 1));
  const result: Partial<Record<(typeof UTM_PARAM_KEYS)[number], string>> = {};
  for (const key of UTM_PARAM_KEYS) {
    const value = params.get(key);
    if (value !== null) {
      result[key] = value;
    }
  }
  return result;
}

/**
 * Ingestion pipeline use case. Order matters: ip and user agent are used
 * only to derive the visitor id and resolve country/device, then never
 * referenced again — they never reach the persisted TrackedEvent.
 */
export class RecordEvent {
  readonly #clock: Clock;
  readonly #saltProvider: SaltProvider;
  readonly #geoResolver: GeoResolver;
  readonly #deviceResolver: DeviceResolver;
  readonly #eventRepository: EventRepository;
  readonly #allowedSites: ReadonlySet<string>;

  constructor(dependencies: RecordEventDependencies) {
    this.#clock = dependencies.clock;
    this.#saltProvider = dependencies.saltProvider;
    this.#geoResolver = dependencies.geoResolver;
    this.#deviceResolver = dependencies.deviceResolver;
    this.#eventRepository = dependencies.eventRepository;
    this.#allowedSites = new Set(
      dependencies.allowedSites
        .map((raw) => createSiteId(raw))
        .filter((result): result is { ok: true; value: SiteId } => result.ok)
        .map((result) => result.value),
    );
  }

  async execute(input: RecordEventInput): Promise<Result<TrackedEvent, RecordEventError>> {
    // 1. Identify the site against the allow-list.
    const siteResult = createSiteId(input.siteHeader);
    if (!siteResult.ok || !this.#allowedSites.has(siteResult.value)) {
      return err('site_not_allowed');
    }
    const site = siteResult.value;

    if (!isEventType(input.type)) {
      return err('invalid_event_type');
    }
    const eventType: EventType = input.type;

    // 2. Resolve the country from the raw IP.
    const country = this.#geoResolver.resolve(input.ip);

    // 3. Resolve the device profile from the raw user agent.
    const device = this.#deviceResolver.resolve(input.userAgent);

    // 4. Derive the visitor id from salt + site + ip + user agent.
    const salt = await this.#saltProvider.current();
    const visitorId = deriveVisitorId({ salt, siteId: site, ip: input.ip, userAgent: input.userAgent });

    // 5. From this point on, input.ip and input.userAgent must never be read again.

    // 6. Resolve the session: same session if the last event for this
    // visitor is within the inactivity window, otherwise a new one.
    const now = this.#clock.now();
    const lastEvent = await this.#eventRepository.findLastEventForVisitor(visitorId);
    const sessionId =
      lastEvent !== undefined && belongsToSameSession(new Date(lastEvent.ts * 1000), now)
        ? lastEvent.sessionId
        : generateSessionId();

    // 7. Sanitize the path and resolve the referrer source.
    const pathQuery = sanitizePagePath(input.path);
    const utmParams = extractUtmParams(pathQuery);
    const referrerSource = resolveReferrerSource({
      referrer: input.referrer,
      site,
      utmSource: utmParams.utm_source,
    });

    const screenBucket = resolveScreenBucket(input);

    const event = createTrackedEvent({
      ts: Math.floor(now.getTime() / 1000),
      siteId: site,
      visitorId,
      sessionId,
      type: eventType,
      path: pathQuery,
      referrerSource,
      country,
      deviceType: device.type,
      browserFamily: device.browserFamily,
      osFamily: device.osFamily,
      ...(utmParams.utm_source !== undefined ? { utmSource: utmParams.utm_source } : {}),
      ...(utmParams.utm_medium !== undefined ? { utmMedium: utmParams.utm_medium } : {}),
      ...(utmParams.utm_campaign !== undefined ? { utmCampaign: utmParams.utm_campaign } : {}),
      ...(utmParams.utm_content !== undefined ? { utmContent: utmParams.utm_content } : {}),
      ...(utmParams.utm_term !== undefined ? { utmTerm: utmParams.utm_term } : {}),
      ...(input.lang !== undefined ? { lang: input.lang } : {}),
      ...(screenBucket !== undefined ? { screenBucket } : {}),
      ...(input.colorScheme !== undefined ? { colorScheme: input.colorScheme } : {}),
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.props !== undefined ? { props: input.props } : {}),
      ...(input.value !== undefined ? { value: input.value } : {}),
    });

    // 8. Persist (in a real adapter this would buffer and flush in batches;
    // the port contract is saveBatch either way).
    await this.#eventRepository.saveBatch([event]);

    return ok(event);
  }
}

import type { SiteId } from './SiteId.ts';
import type { EventType } from './EventType.ts';
import type { GeoCountry } from './GeoCountry.ts';
import type { DeviceType } from './DeviceProfile.ts';
import type { ScreenBucket } from './ScreenBucket.ts';

/**
 * The analytics aggregate. This type declares no `ip` and no `userAgent`
 * field — that is the whole product's privacy invariant, enforced
 * structurally rather than by convention.
 */
export interface TrackedEvent {
  readonly ts: number; // epoch seconds
  readonly siteId: SiteId;
  readonly visitorId: Uint8Array;
  readonly sessionId: Uint8Array;
  readonly type: EventType;
  readonly path: string;
  readonly referrerSource?: string;
  readonly utmSource?: string;
  readonly utmMedium?: string;
  readonly utmCampaign?: string;
  readonly utmContent?: string;
  readonly utmTerm?: string;
  readonly country: GeoCountry;
  readonly deviceType: DeviceType;
  readonly browserFamily: string;
  readonly osFamily: string;
  readonly lang?: string;
  readonly screenBucket?: ScreenBucket;
  readonly colorScheme?: string;
  readonly name?: string;
  readonly props?: Record<string, unknown>;
  readonly value?: number;
}

/**
 * Builds a TrackedEvent by naming every field explicitly. Never spread an
 * arbitrary input object here: doing so would let extra properties (an
 * accidental `ip` or `userAgent` on the caller's raw data) ride along into
 * the persisted aggregate.
 */
export function createTrackedEvent(input: TrackedEvent): TrackedEvent {
  const event: TrackedEvent = {
    ts: input.ts,
    siteId: input.siteId,
    visitorId: input.visitorId,
    sessionId: input.sessionId,
    type: input.type,
    path: input.path,
    country: input.country,
    deviceType: input.deviceType,
    browserFamily: input.browserFamily,
    osFamily: input.osFamily,
    ...(input.referrerSource !== undefined ? { referrerSource: input.referrerSource } : {}),
    ...(input.utmSource !== undefined ? { utmSource: input.utmSource } : {}),
    ...(input.utmMedium !== undefined ? { utmMedium: input.utmMedium } : {}),
    ...(input.utmCampaign !== undefined ? { utmCampaign: input.utmCampaign } : {}),
    ...(input.utmContent !== undefined ? { utmContent: input.utmContent } : {}),
    ...(input.utmTerm !== undefined ? { utmTerm: input.utmTerm } : {}),
    ...(input.lang !== undefined ? { lang: input.lang } : {}),
    ...(input.screenBucket !== undefined ? { screenBucket: input.screenBucket } : {}),
    ...(input.colorScheme !== undefined ? { colorScheme: input.colorScheme } : {}),
    ...(input.name !== undefined ? { name: input.name } : {}),
    ...(input.props !== undefined ? { props: input.props } : {}),
    ...(input.value !== undefined ? { value: input.value } : {}),
  };
  return event;
}

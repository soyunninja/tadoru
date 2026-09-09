/**
 * Pure payload construction for the browser tracker. Kept free of DOM access so
 * it can be unit tested in Node; tracker.ts supplies the browser values.
 */
import { sanitizePagePath } from '../src/analytics/domain/event/PagePath.ts';
import { bucketScreenWidth } from '../src/analytics/domain/event/ScreenBucket.ts';

/**
 * The closed set of keys a payload may ever carry. Anything absent from this
 * list cannot be sent. Adding a fingerprinting signal therefore requires editing
 * this line on purpose, which a test in payload.test.ts guards.
 */
export const PAYLOAD_KEYS = [
  'type',
  'path',
  'referrer',
  'screenBucket',
  'colorScheme',
  'lang',
  'name',
  'props',
  'value',
] as const;

export type PayloadKey = (typeof PAYLOAD_KEYS)[number];

export interface PageContext {
  readonly href: string;
  readonly referrer: string;
  readonly screenWidth: number;
  readonly colorScheme: string;
  readonly lang: string;
}

export interface Payload {
  readonly type: string;
  readonly path: string;
  readonly referrer?: string;
  readonly screenBucket?: string;
  readonly colorScheme?: string;
  readonly lang?: string;
  readonly name?: string;
  readonly props?: Record<string, unknown>;
  readonly value?: number;
}

export function buildPageviewPayload(context: PageContext): Payload {
  return {
    type: 'pageview',
    // Sanitised in the browser, so query parameters that are none of our
    // business never travel over the network in the first place.
    path: sanitizePagePath(context.href),
    referrer: context.referrer,
    // Only the bucket leaves the device; the exact width stays here.
    screenBucket: bucketScreenWidth(context.screenWidth),
    colorScheme: context.colorScheme,
    lang: context.lang,
  };
}

const SCROLL_MILESTONES = [25, 50, 75, 100];

/** Milestones crossed by reaching `current`, given the deepest point reached so far. */
export function newlyCrossedMilestones(previousMax: number, current: number): number[] {
  return SCROLL_MILESTONES.filter((m) => m > previousMax && m <= current);
}

export interface EngagementTimer {
  hide(): void;
  show(): void;
  visibleSeconds(): number;
}

/**
 * Accumulates time the page actually spent visible. A tab left open in the
 * background for an hour must not be reported as an hour of engagement.
 */
export function createEngagementTimer(now: () => number): EngagementTimer {
  let accumulated = 0;
  let shownAt: number | null = now();

  return {
    hide(): void {
      if (shownAt !== null) {
        accumulated += now() - shownAt;
        shownAt = null;
      }
    },
    show(): void {
      if (shownAt === null) shownAt = now();
    },
    visibleSeconds(): number {
      const live = shownAt === null ? 0 : now() - shownAt;
      return Math.round((accumulated + live) / 1000);
    },
  };
}

/**
 * Kinds of tracked events. `enum` is unavailable (erasableSyntaxOnly), so a
 * const tuple plus a derived union type stands in for it.
 */
export const EVENT_TYPES = ['pageview', 'engagement', 'custom', 'outbound', 'vitals'] as const;

export type EventType = (typeof EVENT_TYPES)[number];

export function isEventType(value: string): value is EventType {
  return (EVENT_TYPES as readonly string[]).includes(value);
}

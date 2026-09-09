import type { Locale } from '../../i18n/Locale.ts';
import { DEFAULT_LOCALE } from '../../i18n/Locale.ts';
import { messagesFor } from '../../i18n/messages.ts';

/**
 * Presentation helpers for the country breakdown.
 *
 * Both the flag and the name are derived, not looked up: the flag from
 * arithmetic on the ISO code, the name from `Intl`. That keeps a 250-entry
 * table out of the codebase and adds no dependency.
 */
const ALPHA_2 = /^[A-Za-z]{2}$/;

/** The sentinel stored when geolocation fails; it is not a real region. */
const UNKNOWN_CODE = 'XX';

const REGIONAL_INDICATOR_A = 0x1f1e6;
const LETTER_A = 'A'.charCodeAt(0);

// One Intl.DisplayNames instance per locale, built lazily and reused: a
// breakdown table can render this for dozens of rows per page.
const regionNamesByLocale = new Map<Locale, Intl.DisplayNames>();

function regionNamesFor(locale: Locale): Intl.DisplayNames {
  const cached = regionNamesByLocale.get(locale);
  if (cached !== undefined) return cached;
  const formatter = new Intl.DisplayNames([locale], { type: 'region' });
  regionNamesByLocale.set(locale, formatter);
  return formatter;
}

/**
 * The flag for an ISO-3166 alpha-2 code, or an empty string when there is none
 * to show. Flag emoji are two regional indicator symbols, so the code maps
 * straight onto them by offset — no image, no icon font, no lookup. Not
 * locale-dependent: a flag is the same picture everywhere.
 */
export function countryFlagEmoji(code: string): string {
  const normalized = code.trim().toUpperCase();
  if (!ALPHA_2.test(normalized) || normalized === UNKNOWN_CODE) return '';

  return String.fromCodePoint(
    ...[...normalized].map((letter) => REGIONAL_INDICATOR_A + letter.charCodeAt(0) - LETTER_A),
  );
}

/**
 * The country's name in the given locale — "Spain", "España" or "スペイン"
 * for the same stored code. Falls back to the code itself for a valid but
 * unnamed region, and to the translated "Unknown" for the sentinel or for
 * malformed input — `Intl.DisplayNames` throws a RangeError on an empty
 * string, which must never reach a page render.
 */
export function countryDisplayName(code: string, locale: Locale = DEFAULT_LOCALE): string {
  const normalized = code.trim().toUpperCase();
  if (!ALPHA_2.test(normalized) || normalized === UNKNOWN_CODE) return messagesFor(locale).country.unknown;

  try {
    return regionNamesFor(locale).of(normalized) ?? normalized;
  } catch {
    return normalized;
  }
}

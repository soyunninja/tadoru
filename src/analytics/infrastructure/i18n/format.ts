import type { Locale } from './Locale.ts';

/**
 * Locale-aware number, percent, date and duration formatting for the
 * dashboard. Everything routes through `Intl`, which is already available at
 * runtime — no dependency is added. Formatters are cached per locale (and, for
 * numbers, per set of options) rather than constructed on every call, since a
 * breakdown table can format dozens of cells per render.
 */

export interface FormatNumberOptions {
  readonly minimumFractionDigits?: number;
  readonly maximumFractionDigits?: number;
}

const numberFormatters = new Map<string, Intl.NumberFormat>();

function numberFormatterFor(locale: Locale, options: FormatNumberOptions): Intl.NumberFormat {
  const cacheKey = `${locale}|${options.minimumFractionDigits ?? ''}|${options.maximumFractionDigits ?? ''}`;
  const cached = numberFormatters.get(cacheKey);
  if (cached !== undefined) return cached;

  // useGrouping is forced on (rather than left at the "auto" default): some
  // locales' CLDR data only group once a leading group would have 2+ digits
  // (e.g. plain "auto" formatting renders 1234 as "1234" in Spanish), which
  // reads as ungrouped for exactly the small counts a dashboard shows most.
  const formatter = new Intl.NumberFormat(locale, { useGrouping: true, ...options });
  numberFormatters.set(cacheKey, formatter);
  return formatter;
}

/** Formats a plain count (visitors, pageviews, ...) with the locale's own grouping and decimal conventions. */
export function formatNumber(value: number, locale: Locale, options: FormatNumberOptions = {}): string {
  return numberFormatterFor(locale, options).format(value);
}

/**
 * Formats a fraction (e.g. `0.352`) as a one-decimal percentage string (e.g.
 * `35.2%` in English, `35,2%` in Spanish). The `%` sign is appended literally
 * rather than via `Intl.NumberFormat`'s `style: 'percent'`, so the result
 * never carries a locale-specific space before the sign — callers that strip
 * the sign back off (see `renderHeadline`) can keep doing so with a plain
 * string replace.
 */
export function formatPercent(fraction: number, locale: Locale): string {
  return `${formatNumber(fraction * 100, locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}

const dateFormatters = new Map<Locale, Intl.DateTimeFormat>();

function dateFormatterFor(locale: Locale): Intl.DateTimeFormat {
  const cached = dateFormatters.get(locale);
  if (cached !== undefined) return cached;
  // Fixed to UTC: the stored dates are UTC day boundaries (see
  // dashboardRoutes.ts's isoDateFromDayStart), and formatting in the server's
  // own timezone could shift a date across midnight for no reason tied to
  // the data itself.
  const formatter = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' });
  dateFormatters.set(locale, formatter);
  return formatter;
}

/**
 * Formats an ISO `YYYY-MM-DD` date string for display (e.g. "Jan 1, 2026" in
 * English, "1 ene 2026" in Spanish, "2026/01/01" in Japanese). Never throws:
 * malformed input falls back to the raw string, since a chart label is not
 * worth crashing a page render over.
 */
export function formatIsoDate(isoDate: string, locale: Locale): string {
  const parsed = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return isoDate;
  try {
    return dateFormatterFor(locale).format(parsed);
  } catch {
    return isoDate;
  }
}

/**
 * Formats a duration in seconds as `m:ss`. This is a fixed positional
 * format, not a culturally variable one (nobody reads "2 minutes 5 seconds"
 * as "5:02"), so unlike the formatters above it takes no locale.
 */
export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(total / 60);
  const remainingSeconds = total % 60;
  return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
}

/**
 * The dashboard's supported UI languages. Adding one here without also adding
 * it to `messages.ts` is a compile error there, not a silent English
 * fallback — that is the whole point of typing the catalogue against this
 * union (see `messages.ts`).
 */
export const SUPPORTED_LOCALES = ['en', 'es', 'ja'] as const;

export type Locale = (typeof SUPPORTED_LOCALES)[number];

/** Used whenever nothing else resolves a language: no `?lang=`, no `TADORU_LANG`, no usable `Accept-Language`. */
export const DEFAULT_LOCALE: Locale = 'en';

/** Each language's own name for itself, shown in the language switcher regardless of the page's current locale. */
export const LOCALE_NATIVE_NAMES: Readonly<Record<Locale, string>> = {
  en: 'English',
  es: 'Español',
  ja: '日本語',
};

export function isSupportedLocale(value: string): value is Locale {
  return (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

interface WeightedLanguageTag {
  readonly tag: string;
  readonly quality: number;
}

const QUALITY_PARAM = /^q=([01](?:\.\d{1,3})?)$/i;

/**
 * Splits one `Accept-Language` header into its weighted tags, highest
 * quality first. Never throws: a malformed segment is simply dropped rather
 * than failing the whole header, since this runs on every request and the
 * header is fully attacker-controlled.
 */
function parseWeightedTags(header: string): readonly WeightedLanguageTag[] {
  const entries: WeightedLanguageTag[] = [];

  for (const rawPart of header.split(',')) {
    const part = rawPart.trim();
    if (part.length === 0) continue;

    const segments = part.split(';').map((segment) => segment.trim());
    const tag = segments[0];
    if (tag === undefined || tag.length === 0) continue;

    let quality = 1;
    for (const param of segments.slice(1)) {
      const match = QUALITY_PARAM.exec(param);
      if (match === null) continue;
      const parsedQuality = match[1];
      if (parsedQuality === undefined) continue;
      const value = Number.parseFloat(parsedQuality);
      if (Number.isFinite(value)) quality = value;
    }

    entries.push({ tag, quality });
  }

  return entries;
}

/**
 * Picks the best supported locale out of an `Accept-Language` header, or
 * `undefined` when nothing in it is supported. Honours `q=` weights, matches
 * a regional tag like `es-ES` or `ja-JP` by its primary subtag, ignores
 * unknown languages, and never throws on malformed input (a missing or
 * empty header, stray commas/semicolons, a garbage `q=` value, ...).
 */
export function negotiateAcceptLanguage(header: string | undefined): Locale | undefined {
  if (header === undefined) return undefined;
  const trimmed = header.trim();
  if (trimmed.length === 0) return undefined;

  const weighted = parseWeightedTags(trimmed)
    .filter((entry) => entry.quality > 0)
    // Stable sort: entries with equal quality keep the header's own order,
    // which is itself already the client's preference order.
    .map((entry, index) => ({ ...entry, index }))
    .sort((a, b) => b.quality - a.quality || a.index - b.index);

  for (const entry of weighted) {
    const primarySubtag = entry.tag.split('-')[0]?.toLowerCase();
    if (primarySubtag !== undefined && isSupportedLocale(primarySubtag)) {
      return primarySubtag;
    }
  }

  return undefined;
}

export interface ResolveLocaleOptions {
  /** The `?lang=` query parameter, if present on the request. Wins over everything else when it names a supported locale. */
  readonly queryLang?: string | undefined;
  /** The operator's `TADORU_LANG` setting, if configured — see `loadConfig.ts`. */
  readonly configuredLocale?: Locale | undefined;
  /** The request's raw `Accept-Language` header value. */
  readonly acceptLanguageHeader?: string | undefined;
}

/**
 * Resolves the language a single request should be served in, in the order
 * specs/dashboard/spec.md (via the i18n change) requires:
 *
 *   1. `?lang=` on the query string, when it names a supported locale.
 *   2. The operator's `TADORU_LANG`, if set.
 *   3. Negotiation from `Accept-Language`.
 *   4. `DEFAULT_LOCALE` (English).
 */
export function resolveLocale(options: ResolveLocaleOptions): Locale {
  if (options.queryLang !== undefined && isSupportedLocale(options.queryLang)) {
    return options.queryLang;
  }
  if (options.configuredLocale !== undefined) {
    return options.configuredLocale;
  }
  const negotiated = negotiateAcceptLanguage(options.acceptLanguageHeader);
  if (negotiated !== undefined) {
    return negotiated;
  }
  return DEFAULT_LOCALE;
}

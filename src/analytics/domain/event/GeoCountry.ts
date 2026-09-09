/**
 * ISO-3166 alpha-2 country code, and nothing finer-grained. `XX` is the
 * conventional "unknown/unassigned" sentinel used when geo resolution fails,
 * standing in for a null value while keeping the type a plain string.
 */
export type GeoCountry = string & { readonly __brand: 'GeoCountry' };

export const UNKNOWN_COUNTRY = 'XX' as GeoCountry;

const ALPHA_2_PATTERN = /^[A-Z]{2}$/;

export function createGeoCountry(raw: string | null | undefined): GeoCountry {
  if (typeof raw !== 'string') return UNKNOWN_COUNTRY;
  const upper = raw.toUpperCase();
  return ALPHA_2_PATTERN.test(upper) ? (upper as GeoCountry) : UNKNOWN_COUNTRY;
}

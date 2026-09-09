import type { GeoResolver } from '../../domain/ports/GeoResolver.ts';
import type { GeoCountry } from '../../domain/event/GeoCountry.ts';
import { createGeoCountry, UNKNOWN_COUNTRY } from '../../domain/event/GeoCountry.ts';

export interface GeoipLookup {
  lookup(ip: string): { readonly country?: string } | null;
}

// `geoip-lite` ships no type declarations of its own and there is no
// `@types/geoip-lite` package; suppress the "implicit any" error for this
// one import rather than adding a project-wide ambient module declaration.
// @ts-expect-error -- untyped CJS module, see comment above
import geoipModule from 'geoip-lite';
const geoip = geoipModule as GeoipLookup;

/**
 * Adapter over `geoip-lite`: a local, offline IP-to-country database, so
 * resolution never makes a network request and the IP never leaves the
 * process. Only the ISO-3166 alpha-2 country code is ever returned — the
 * library's region, city and coordinate fields are deliberately discarded.
 */
export class GeoipLiteResolver implements GeoResolver {
  readonly #lookup: GeoipLookup;

  constructor(lookup: GeoipLookup = geoip) {
    this.#lookup = lookup;
  }

  resolve(ip: string): GeoCountry {
    try {
      const result = this.#lookup.lookup(ip);
      return createGeoCountry(result?.country);
    } catch {
      return UNKNOWN_COUNTRY;
    }
  }
}

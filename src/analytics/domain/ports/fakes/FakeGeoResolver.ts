import type { GeoResolver } from '../GeoResolver.ts';
import type { GeoCountry } from '../../event/GeoCountry.ts';
import { UNKNOWN_COUNTRY } from '../../event/GeoCountry.ts';

/**
 * In-memory GeoResolver fake, configurable per IP with an unknown-country
 * fallback.
 */
export class FakeGeoResolver implements GeoResolver {
  #byIp: Map<string, GeoCountry>;
  #fallback: GeoCountry;

  constructor(byIp: Readonly<Record<string, GeoCountry>> = {}, fallback: GeoCountry = UNKNOWN_COUNTRY) {
    this.#byIp = new Map(Object.entries(byIp));
    this.#fallback = fallback;
  }

  resolve(ip: string): GeoCountry {
    return this.#byIp.get(ip) ?? this.#fallback;
  }

  set(ip: string, country: GeoCountry): void {
    this.#byIp.set(ip, country);
  }
}

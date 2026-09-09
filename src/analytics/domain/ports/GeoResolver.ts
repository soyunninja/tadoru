import type { GeoCountry } from '../event/GeoCountry.ts';

/**
 * Driven port that maps an IP address to a country. Resolution stays local
 * to the process; the IP itself never leaves it and is never persisted.
 */
export interface GeoResolver {
  resolve(ip: string): GeoCountry;
}

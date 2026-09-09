import type { DeviceProfile } from '../event/DeviceProfile.ts';

/**
 * Driven port that maps a user agent (and optional client hints) to a
 * coarse device profile. Only families are ever returned, never a full
 * version string.
 */
export interface DeviceResolver {
  resolve(userAgent: string, clientHints?: Readonly<Record<string, string>>): DeviceProfile;
}

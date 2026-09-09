import type { DeviceResolver } from '../DeviceResolver.ts';
import type { DeviceProfile } from '../../event/DeviceProfile.ts';

const DEFAULT_PROFILE: DeviceProfile = { type: 'unknown', browserFamily: 'unknown', osFamily: 'unknown' };

/**
 * In-memory DeviceResolver fake, configurable per exact user-agent string
 * with a default fallback profile.
 */
export class FakeDeviceResolver implements DeviceResolver {
  #byUserAgent: Map<string, DeviceProfile>;
  #fallback: DeviceProfile;

  constructor(byUserAgent: Readonly<Record<string, DeviceProfile>> = {}, fallback: DeviceProfile = DEFAULT_PROFILE) {
    this.#byUserAgent = new Map(Object.entries(byUserAgent));
    this.#fallback = fallback;
  }

  resolve(userAgent: string): DeviceProfile {
    return this.#byUserAgent.get(userAgent) ?? this.#fallback;
  }

  set(userAgent: string, profile: DeviceProfile): void {
    this.#byUserAgent.set(userAgent, profile);
  }
}

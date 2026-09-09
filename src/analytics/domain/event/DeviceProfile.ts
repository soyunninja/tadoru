/**
 * Coarse device classification. Only families are retained — never a full
 * version string (e.g. "Chrome" never "Chrome 131.0.6778.86") — since a
 * precise version is a fingerprinting vector.
 */
export const DEVICE_TYPES = ['desktop', 'mobile', 'tablet', 'tv', 'bot', 'unknown'] as const;

export type DeviceType = (typeof DEVICE_TYPES)[number];

export function isDeviceType(value: string): value is DeviceType {
  return (DEVICE_TYPES as readonly string[]).includes(value);
}

export interface DeviceProfile {
  readonly type: DeviceType;
  readonly browserFamily: string;
  readonly osFamily: string;
}

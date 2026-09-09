import DeviceDetectorCtor from 'node-device-detector';
import type { DetectResult, ResultBot, DeviceDetectorOptions } from 'node-device-detector';
import type { DeviceResolver } from '../../domain/ports/DeviceResolver.ts';
import type { DeviceProfile, DeviceType } from '../../domain/event/DeviceProfile.ts';

const UNKNOWN_FAMILY = 'unknown';

/**
 * The package's shipped `.d.ts` declares its default export with ESM
 * `export default class` syntax even though the package itself is
 * CommonJS, which under `nodenext` module resolution loses its construct
 * signature (the whole module's namespace type is inferred instead). This
 * local interface plus one narrowing cast restores just the surface this
 * adapter needs, matching how the actual JS export behaves at runtime.
 */
interface DeviceDetectorLike {
  detect(userAgent: string, clientHints?: Readonly<Record<string, string>>): DetectResult;
  parseBot(userAgent: string, clientHints?: Readonly<Record<string, string>>): ResultBot | Record<string, never>;
}

type DeviceDetectorConstructor = new (options?: DeviceDetectorOptions) => DeviceDetectorLike;

/** Maps the library's fine-grained device types onto our coarse, closed set. */
const DEVICE_TYPE_MAP: Readonly<Record<string, DeviceType>> = {
  desktop: 'desktop',
  tablet: 'tablet',
  tv: 'tv',
  smartphone: 'mobile',
  phablet: 'mobile',
  'feature phone': 'mobile',
  wearable: 'mobile',
  'car browser': 'mobile',
  'smart display': 'mobile',
  'smart speaker': 'mobile',
  'portable media player': 'mobile',
  camera: 'mobile',
  console: 'mobile',
  peripheral: 'mobile',
};

function mapDeviceType(raw: string): DeviceType {
  return DEVICE_TYPE_MAP[raw] ?? 'unknown';
}

/**
 * Adapter over `node-device-detector`. Only device type family and the
 * browser/OS family names are ever returned — never a version string, since
 * a precise version is a fingerprinting vector (see DeviceProfile).
 */
export class NodeDeviceDetectorResolver implements DeviceResolver {
  readonly #detector: DeviceDetectorLike;

  constructor() {
    const Ctor = DeviceDetectorCtor as unknown as DeviceDetectorConstructor;
    this.#detector = new Ctor({ skipBotDetection: false });
  }

  resolve(userAgent: string, clientHints?: Readonly<Record<string, string>>): DeviceProfile {
    const bot = this.#detector.parseBot(userAgent, clientHints);
    if (bot !== undefined && bot !== null && typeof bot.name === 'string' && bot.name.length > 0) {
      return { type: 'bot', browserFamily: UNKNOWN_FAMILY, osFamily: UNKNOWN_FAMILY };
    }

    const result = this.#detector.detect(userAgent, clientHints);
    const rawDeviceType = result.device.type;
    const type = rawDeviceType.length > 0 ? mapDeviceType(rawDeviceType) : 'unknown';
    const browserFamily = result.client.family ?? result.client.name ?? UNKNOWN_FAMILY;
    const osFamily = result.os.family ?? result.os.name ?? UNKNOWN_FAMILY;

    return {
      type,
      browserFamily: browserFamily.length > 0 ? browserFamily : UNKNOWN_FAMILY,
      osFamily: osFamily.length > 0 ? osFamily : UNKNOWN_FAMILY,
    };
  }
}

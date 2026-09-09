/**
 * Opt-out signals the tracker honours before recording anything.
 *
 * The privacy notice shipped in docs/privacy-policy-template.md tells visitors
 * that Do Not Track prevents measurement. This module is what makes that
 * statement true, so it runs before any network request is made.
 */
export interface ConsentSignals {
  readonly doNotTrack: string | null | undefined;
  readonly globalPrivacyControl: boolean | undefined;
  readonly hostname: string;
  readonly protocol: string;
  readonly visibilityState: string;
}

const DO_NOT_TRACK_ENABLED = ['1', 'yes', 'true'];

const LOCAL_HOSTNAMES = ['localhost', '127.0.0.1', '::1', '0.0.0.0'];

function isLocal(hostname: string): boolean {
  return LOCAL_HOSTNAMES.includes(hostname) || hostname.endsWith('.local');
}

export function shouldTrack(signals: ConsentSignals): boolean {
  if (signals.globalPrivacyControl === true) return false;

  const dnt = (signals.doNotTrack ?? '').toLowerCase();
  if (DO_NOT_TRACK_ENABLED.includes(dnt)) return false;

  // A prerendered page was never actually seen by anyone.
  if (signals.visibilityState === 'prerender') return false;

  // Local development and files opened from disk are noise, not audience.
  if (signals.protocol === 'file:') return false;
  if (isLocal(signals.hostname)) return false;

  return true;
}

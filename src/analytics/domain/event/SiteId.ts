import type { Result } from '../../../shared/Result.ts';
import { ok, err } from '../../../shared/Result.ts';

/**
 * A validated, canonicalised site host derived from an `Origin` or `Referer`
 * header. Branded to avoid mixing up with arbitrary strings.
 */
export type SiteId = string & { readonly __brand: 'SiteId' };

const MAX_HOST_LENGTH = 253;
const IPV4_PATTERN = /^\d{1,3}(\.\d{1,3}){3}$/;

function isIpLiteral(host: string): boolean {
  if (host.startsWith('[') && host.endsWith(']')) return true; // IPv6, bracketed by URL
  return IPV4_PATTERN.test(host);
}

export function createSiteId(raw: string): Result<SiteId, string> {
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    return err('SiteId: value is empty');
  }
  if (/\s/.test(raw)) {
    return err('SiteId: value contains whitespace');
  }
  if (raw.includes('..')) {
    return err('SiteId: value contains path traversal');
  }

  let hostname: string;
  try {
    const withScheme = raw.includes('://') ? raw : `http://${raw}`;
    hostname = new URL(withScheme).hostname;
  } catch {
    return err('SiteId: value is not a valid host or URL');
  }

  if (hostname.length === 0) {
    return err('SiteId: host is empty');
  }
  if (isIpLiteral(hostname)) {
    return err('SiteId: IP literals are not allowed');
  }

  let host = hostname.toLowerCase();
  host = host.replace(/\.+$/, ''); // strip trailing dot(s)
  if (host.startsWith('www.')) {
    host = host.slice('www.'.length);
  }

  if (host.length === 0) {
    return err('SiteId: host is empty after normalisation');
  }
  if (host.length > MAX_HOST_LENGTH) {
    return err('SiteId: host exceeds maximum length');
  }

  return ok(host as SiteId);
}

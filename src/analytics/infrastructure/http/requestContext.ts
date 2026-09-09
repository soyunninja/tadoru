/**
 * Minimal header shape shared by every HTTP adapter in this module. Kept
 * intentionally narrow (rather than importing Fastify's request type) so
 * these functions stay pure and trivially testable with plain objects.
 */
export type HeaderMap = Readonly<Record<string, string | readonly string[] | undefined>>;

const CLIENT_HINT_HEADER_NAMES = [
  'sec-ch-ua',
  'sec-ch-ua-mobile',
  'sec-ch-ua-platform',
  'sec-ch-ua-platform-version',
  'sec-ch-ua-full-version-list',
] as const;

function firstValue(value: string | readonly string[] | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'string') return value;
  return value[0];
}

function firstCommaSeparatedEntry(value: string): string {
  const [first] = value.split(',');
  return (first ?? value).trim();
}

/**
 * Resolves the visitor's IP address. When `trustedProxy` is false, the
 * `X-Forwarded-For` header is IGNORED ENTIRELY and the raw socket address is
 * returned: trusting that header without a reverse proxy in front of the
 * process lets any caller forge their own IP address, and therefore forge
 * their resolved country. Only a deployment that explicitly configured a
 * trusted proxy gets to use the header at all.
 */
export function resolveClientIp(headers: HeaderMap, socketAddress: string, trustedProxy: boolean): string {
  if (!trustedProxy) {
    return socketAddress;
  }

  const forwardedFor = firstValue(headers['x-forwarded-for']);
  if (forwardedFor === undefined || forwardedFor.length === 0) {
    return socketAddress;
  }

  return firstCommaSeparatedEntry(forwardedFor);
}

/**
 * Resolves the header that identifies the measured site: `Origin` for
 * fetch/XHR beacon requests, falling back to `Referer` for pixel requests
 * (a `<img>` tag never sends `Origin`).
 */
export function resolveSiteHeader(headers: HeaderMap): string | undefined {
  const origin = firstValue(headers['origin']);
  if (origin !== undefined && origin.length > 0) {
    return origin;
  }

  const referer = firstValue(headers['referer']);
  if (referer !== undefined && referer.length > 0) {
    return referer;
  }

  return undefined;
}

/**
 * Reads only the `Sec-CH-UA*` client hint headers that are actually present.
 * These are coarse, structured browser-supplied hints (not fingerprinting
 * signals): they are the modern replacement for parsing a version out of
 * the user-agent string.
 */
export function resolveClientHints(headers: HeaderMap): Record<string, string> {
  const hints: Record<string, string> = {};
  for (const name of CLIENT_HINT_HEADER_NAMES) {
    const value = firstValue(headers[name]);
    if (value !== undefined) {
      hints[name] = value;
    }
  }
  return hints;
}

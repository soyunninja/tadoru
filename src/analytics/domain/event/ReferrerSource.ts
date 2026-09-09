import type { SiteId } from './SiteId.ts';

/**
 * Groups a raw referrer (plus an optional explicit utm_source) into a single
 * canonical source string.
 */

const KNOWN_SOURCES: Readonly<Record<string, string>> = {
  'bing.com': 'Bing',
  'duckduckgo.com': 'DuckDuckGo',
  'ecosia.org': 'Ecosia',
  'search.brave.com': 'Brave',
  'x.com': 'X',
  'twitter.com': 'X',
  't.co': 'X',
  'facebook.com': 'Facebook',
  'm.facebook.com': 'Facebook',
  'linkedin.com': 'LinkedIn',
  'lnkd.in': 'LinkedIn',
  'reddit.com': 'Reddit',
  'news.ycombinator.com': 'Hacker News',
  'github.com': 'GitHub',
  'youtube.com': 'YouTube',
};

function stripWww(host: string): string {
  return host.startsWith('www.') ? host.slice('www.'.length) : host;
}

function classifyKnownHost(host: string): string | undefined {
  const bare = stripWww(host);
  if (bare === 'google.com' || bare.startsWith('google.')) return 'Google';
  if (bare === 'yandex.com' || bare.startsWith('yandex.')) return 'Yandex';
  return KNOWN_SOURCES[bare];
}

export interface ResolveReferrerSourceInput {
  readonly referrer?: string | undefined;
  readonly site: SiteId;
  readonly utmSource?: string | undefined;
}

export function resolveReferrerSource(input: ResolveReferrerSourceInput): string {
  const { referrer, site, utmSource } = input;

  if (utmSource !== undefined && utmSource.length > 0) {
    return utmSource;
  }

  if (referrer === undefined || referrer.length === 0) {
    return 'direct';
  }

  let hostname: string;
  try {
    hostname = new URL(referrer).hostname.toLowerCase();
  } catch {
    return 'direct';
  }
  if (hostname.length === 0) {
    return 'direct';
  }

  const bareReferrerHost = stripWww(hostname);
  if (bareReferrerHost === site) {
    return 'internal';
  }

  return classifyKnownHost(hostname) ?? bareReferrerHost;
}

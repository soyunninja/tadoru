/**
 * Sanitises a raw path or URL into a privacy-safe page path.
 *
 * This is a privacy control, not just cosmetic normalisation: it strips the
 * fragment, keeps only an allow-listed set of query parameters, and redacts
 * path segments that look like PII or stable identifiers.
 */

const ALLOWED_QUERY_PARAMS = new Set([
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_content',
  'utm_term',
  'ref',
]);

const MAX_LENGTH = 1024;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DIGIT_RUN_PATTERN = /\d{6,}/;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{20,}$/;

function safeDecodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function redactSegment(segment: string): string {
  if (segment.length === 0) return segment;
  if (EMAIL_PATTERN.test(segment)) return ':email';
  if (UUID_PATTERN.test(segment)) return ':uuid';
  if (DIGIT_RUN_PATTERN.test(segment)) return ':id';
  if (TOKEN_PATTERN.test(segment)) return ':token';
  return segment;
}

function sanitizeQuery(search: string): string {
  if (search.length === 0) return '';
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(search);
  } catch {
    return '';
  }

  const kept: string[] = [];
  for (const [key, value] of params) {
    if (ALLOWED_QUERY_PARAMS.has(key)) {
      kept.push(`${key}=${value}`);
    }
  }
  return kept.length > 0 ? `?${kept.join('&')}` : '';
}

export function sanitizePagePath(rawInput: string): string {
  const raw = typeof rawInput === 'string' ? rawInput : '';

  let pathname = '/';
  let search = '';
  try {
    const url = new URL(raw, 'http://placeholder.invalid');
    pathname = url.pathname;
    search = url.search;
  } catch {
    pathname = '/';
    search = '';
  }

  // Ensure leading slash, collapse duplicate slashes.
  if (!pathname.startsWith('/')) pathname = `/${pathname}`;
  pathname = pathname.replace(/\/{2,}/g, '/');

  const segments = pathname.split('/').map((segment) => redactSegment(safeDecodeSegment(segment)));
  let normalizedPath = segments.join('/');

  // Strip trailing slash, except for root.
  if (normalizedPath.length > 1 && normalizedPath.endsWith('/')) {
    normalizedPath = normalizedPath.slice(0, -1);
  }
  if (normalizedPath.length === 0) {
    normalizedPath = '/';
  }

  const query = sanitizeQuery(search);
  const full = `${normalizedPath}${query}`;

  return full.length > MAX_LENGTH ? full.slice(0, MAX_LENGTH) : full;
}

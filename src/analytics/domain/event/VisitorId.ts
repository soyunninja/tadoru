import { createHash } from 'node:crypto';

/**
 * Derives a daily-rotating visitor id from salt + site + ip + user agent.
 * The salt rotates every 24h and the destroyed previous salt is what
 * prevents cross-day correlation; ip and userAgent must never travel any
 * further than this function.
 */

export interface DeriveVisitorIdInput {
  readonly salt: string;
  readonly siteId: string;
  readonly ip: string;
  readonly userAgent: string;
}

const VISITOR_ID_LENGTH = 16;

/**
 * Length-prefixes a field before concatenation so that different splits of
 * the same characters across fields (e.g. "ab"+"c" vs "a"+"bc") cannot
 * produce the same byte sequence and therefore cannot collide.
 */
function lengthPrefixed(field: string): Buffer {
  const data = Buffer.from(field, 'utf8');
  const prefix = Buffer.alloc(4);
  prefix.writeUInt32BE(data.length, 0);
  return Buffer.concat([prefix, data]);
}

export function deriveVisitorId(input: DeriveVisitorIdInput): Buffer {
  const payload = Buffer.concat([
    lengthPrefixed(input.salt),
    lengthPrefixed(input.siteId),
    lengthPrefixed(input.ip),
    lengthPrefixed(input.userAgent),
  ]);

  const digest = createHash('blake2b512').update(payload).digest();
  return digest.subarray(0, VISITOR_ID_LENGTH);
}

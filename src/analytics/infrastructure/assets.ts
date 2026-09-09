import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { findPackageRoot } from './packageRoot.ts';

/**
 * The static assets bundled with the package, and the URLs they are served at.
 *
 * Lives outside the HTTP layer because both the route that serves the font and
 * the stylesheet that references it need the same URL, and a view importing a
 * route module would have the dependency backwards.
 */
const FONT_PATH = ['assets', 'fonts', 'jetbrains-mono-subset.woff2'];

/**
 * Filesystem access, injectable so the failure branches can be tested. Both of
 * them must degrade to `null` rather than throw: a missing font is cosmetic —
 * the CSS stack falls back to a system monospace — but an exception here would
 * happen during boot and take the whole server down over a typeface.
 */
export interface AssetPorts {
  readonly findRoot?: (moduleUrl: string) => string | null;
  readonly readFile?: (path: string) => Buffer;
}

/** Reads the bundled font from the package root, or null when it is absent. */
export function readBundledFont(ports: AssetPorts = {}): Buffer | null {
  const findRoot = ports.findRoot ?? findPackageRoot;
  const readFile = ports.readFile ?? readFileSync;

  const packageRoot = findRoot(import.meta.url);
  if (packageRoot === null) return null;
  try {
    return readFile(join(packageRoot, ...FONT_PATH));
  } catch {
    return null;
  }
}

/**
 * The URL for a given font, carrying a digest of its contents.
 *
 * Content-addressing is what makes the year-long immutable cache header safe.
 * Serving a changing file from a fixed URL under that header strands every
 * browser that already fetched it — regenerating the subset to add icons would
 * never reach anyone who had loaded the previous one.
 */
export function fontUrlFor(font: Buffer | null): string {
  if (font === null) return '/assets/jetbrains-mono.woff2';
  const digest = createHash('sha256').update(font).digest('hex').slice(0, 12);
  return `/assets/jetbrains-mono.${digest}.woff2`;
}

/** Read once per process: the file cannot change while the server is running. */
export const BUNDLED_FONT: Buffer | null = readBundledFont();

export const BUNDLED_FONT_URL: string = fontUrlFor(BUNDLED_FONT);

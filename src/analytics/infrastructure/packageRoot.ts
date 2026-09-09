import { readFileSync } from 'node:fs';
import { dirname, join, parse } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Locates the installed package root by walking up from a module's own URL
 * until it finds this package's `package.json`.
 *
 * A fixed number of `..` segments cannot work here: the development tree puts a
 * module at `src/analytics/…` while the published tree puts the same module at
 * `dist/src/analytics/…`, one level deeper. Hardcoding the depth is correct in
 * exactly one of them, and the mistake is invisible until the package is
 * installed — at which point version and asset lookups silently fall back to
 * placeholders.
 */
const PACKAGE_NAME = 'tadoru';

export function findPackageRoot(moduleUrl: string): string | null {
  let directory = dirname(fileURLToPath(moduleUrl));
  const { root } = parse(directory);

  for (;;) {
    try {
      const parsed = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8')) as {
        name?: unknown;
      };
      // A vendored dependency's manifest must not be mistaken for ours.
      if (parsed.name === PACKAGE_NAME) return directory;
    } catch {
      // No manifest here, or an unreadable one: keep walking up.
    }

    if (directory === root) return null;
    const parent = dirname(directory);
    if (parent === directory) return null;
    directory = parent;
  }
}

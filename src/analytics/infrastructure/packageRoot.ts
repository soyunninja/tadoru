import { readFileSync } from 'node:fs';
import { dirname, join, parse } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Locates the installed package root by walking up from a starting directory
 * until it finds this package's own `package.json`.
 *
 * Two rules make this the single place that may perform the walk:
 *
 * A fixed number of `..` segments cannot work. The development tree puts a
 * module at `src/analytics/…` while the published tree puts the same module at
 * `dist/src/analytics/…`, one level deeper, and a global npm prefix is deeper
 * still. Hardcoding the depth — or capping it — is correct in one layout and
 * silently wrong in the others, and the mistake stays invisible until the
 * package is installed.
 *
 * The manifest must also be *ours*. Stopping at the first `package.json` that
 * happens to have a `version` picks up any vendored dependency sitting between
 * the caller and the real root, and then the CLI and the dashboard footer
 * report someone else's version.
 */
const PACKAGE_NAME = 'tadoru';

export type ReadFile = (path: string) => string;

const defaultReadFile: ReadFile = (path) => readFileSync(path, 'utf8');

/** Walks up from a directory. Returns null rather than throwing when nothing matches. */
export function findPackageRootFrom(directory: string, readFile: ReadFile = defaultReadFile): string | null {
  let current = directory;
  const { root } = parse(current);

  for (;;) {
    try {
      const parsed = JSON.parse(readFile(join(current, 'package.json'))) as { name?: unknown };
      if (parsed.name === PACKAGE_NAME) return current;
    } catch {
      // No manifest here, or an unreadable one: keep walking up.
    }

    if (current === root) return null;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

/** Walks up from a module's own URL, for callers that have `import.meta.url`. */
export function findPackageRoot(moduleUrl: string, readFile: ReadFile = defaultReadFile): string | null {
  return findPackageRootFrom(dirname(fileURLToPath(moduleUrl)), readFile);
}

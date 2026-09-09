import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { findPackageRoot } from '../packageRoot.ts';

/**
 * Serves the browser tracker bundle.
 *
 * Delivery is deliberately separate from ingestion: `collectRoutes.ts` receives
 * events, this hands out the script that produces them.
 */
export interface TrackerRoutesDependencies {
  /** The built bundle, or null when `npm run build:tracker` has not been run. */
  readonly trackerScript: Buffer | null;
}

// Long enough to spare a request on most page views, short enough that shipping
// a fix reaches visitors the same day. `must-revalidate` keeps a stale copy from
// outliving its max-age on a proxy.
const CACHE_CONTROL = 'public, max-age=3600, must-revalidate';

/** Reads `public/t.js` from the package root, or null when it has not been built. */
export function readTrackerScript(): Buffer | null {
  const packageRoot = findPackageRoot(import.meta.url);
  if (packageRoot === null) return null;
  try {
    return readFileSync(join(packageRoot, 'public', 't.js'));
  } catch {
    return null;
  }
}

export function registerTrackerRoutes(fastify: FastifyInstance, deps: TrackerRoutesDependencies): void {
  fastify.get('/t.js', async (_request, reply) => {
    if (deps.trackerScript === null) {
      // A 404 here reads like a typo in the snippet and sends the operator
      // hunting in the wrong place. Say plainly that the bundle is missing.
      return reply
        .code(503)
        .type('text/plain; charset=utf-8')
        .send('Tracker bundle missing. Run "npm run build:tracker" to build public/t.js.');
    }

    return reply
      .code(200)
      .type('application/javascript; charset=utf-8')
      .header('Cache-Control', CACHE_CONTROL)
      // The script is embedded by every measured site, so it must be readable
      // from any origin. It carries no credentials and returns no data.
      .header('Access-Control-Allow-Origin', '*')
      .send(deps.trackerScript);
  });
}

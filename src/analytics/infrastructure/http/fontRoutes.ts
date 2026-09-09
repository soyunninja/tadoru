import type { FastifyInstance } from 'fastify';
import { fontUrlFor } from '../assets.ts';

/**
 * Serves the subsetted web font.
 *
 * Shipping it means every operator sees the same typography and the same icon
 * glyphs, not only those who happen to have the font installed. The subset is
 * about 30 KB; the full Nerd-patched source is 2.5 MB, almost all of it icons
 * this project does not use. See assets/fonts/NOTICE.md for the licensing.
 */
export interface FontRoutesDependencies {
  readonly font: Buffer | null;
}

/**
 * A year, immutable — safe only because the URL is content-addressed. See
 * `fontUrlFor` for what goes wrong otherwise.
 */
const CACHE_CONTROL = 'public, max-age=31536000, immutable';

export function registerFontRoutes(fastify: FastifyInstance, deps: FontRoutesDependencies): void {
  // Registered at the content-addressed path, so a regenerated subset is a new
  // URL and the immutable cache above can never serve a stale one.
  fastify.get(fontUrlFor(deps.font), async (_request, reply) => {
    if (deps.font === null) {
      // Cosmetic, never fatal: the CSS stack falls back to a system monospace.
      return reply.code(404).type('text/plain; charset=utf-8').send('Font not bundled.');
    }
    return reply.code(200).type('font/woff2').header('Cache-Control', CACHE_CONTROL).send(deps.font);
  });
}

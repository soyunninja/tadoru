/**
 * Bundles the browser tracker into public/t.js.
 *
 * The domain modules it imports (PagePath, ScreenBucket) are pure, so esbuild
 * inlines them. That keeps path sanitisation and screen bucketing defined once
 * and shared by browser and server, rather than duplicated and drifting.
 */
import { build } from 'esbuild';
import { mkdir, readFile, stat } from 'node:fs/promises';

const OUTFILE = 'public/t.js';

// A tracker is loaded on every page view of every measured site. If this budget
// starts hurting, drop a feature — do not raise the number quietly.
const SIZE_BUDGET_BYTES = 6144;

const { version, repository } = JSON.parse(await readFile('package.json', 'utf8')) as {
  version: string;
  repository?: { url?: string };
};
// Normalised from package.json so the repository URL is declared in exactly one
// place: `npm pkg set repository.url=...` propagates here and to the banner below.
const sourceUrl = (repository?.url ?? '')
  .replace(/^git\+/, '')
  .replace(/\.git$/, '');

await mkdir('public', { recursive: true });

await build({
  entryPoints: ['tracker/tracker.ts'],
  outfile: OUTFILE,
  bundle: true,
  minify: true,
  format: 'iife',
  target: ['es2020'],
  legalComments: 'none',
  // AGPL section 13: this file is delivered to people over a network, so it has
  // to point them at its source. `legalComments: 'none'` strips comments from the
  // bundled modules, but a banner is emitted separately and survives that.
  banner: { js: `/*! Tadoru v${version} | AGPL-3.0-only | ${sourceUrl} */` },
});

const { size } = await stat(OUTFILE);
const budget = `${size} B / ${SIZE_BUDGET_BYTES} B budget`;

if (size > SIZE_BUDGET_BYTES) {
  console.error(`✖ ${OUTFILE} exceeds its size budget: ${budget}`);
  process.exit(1);
}

console.log(`✔ ${OUTFILE} — ${budget}`);

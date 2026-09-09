/**
 * Regenerates the subsetted web font shipped with the dashboard.
 *
 * Run this only when the character set changes; the output is checked into
 * `assets/fonts/` because the source TTF is a 2.5 MB local install that cannot
 * reasonably be vendored or fetched at build time.
 *
 *   npm run build:font -- /path/to/JetBrainsMonoNerdFont-Regular.ttf
 *
 * The subset carries text glyphs plus the handful of Nerd Font icons the
 * interface uses. Those come from the Font Awesome range (U+F000–U+F2FF) and
 * are CC BY 4.0, which requires attribution — see assets/fonts/NOTICE.md.
 * Bundling them is what makes the icons render for every operator rather than
 * only on machines with the font installed.
 */
import subsetFont from 'subset-font';
import { HEADLINE_ICON_GLYPHS } from '../src/analytics/infrastructure/http/views/components.ts';
import { OPERATING_SYSTEM_ICON_GLYPHS } from '../src/analytics/infrastructure/http/views/operatingSystem.ts';
import { BROWSER_ICON_GLYPHS } from '../src/analytics/infrastructure/http/views/browser.ts';
import { DEVICE_ICON_GLYPHS } from '../src/analytics/infrastructure/http/views/device.ts';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const DEFAULT_SOURCE = join(homedir(), 'Library/Fonts/JetBrainsMonoNerdFont-Regular.ttf');
const OUTPUT = 'assets/fonts/jetbrains-mono-subset.woff2';

// Latin text a dashboard actually renders, plus the punctuation and accented
// characters that appear in page paths and country names.
const CHARSET =
  ' !"#$%&\'()*+,-./0123456789:;<=>?@' +
  'ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~' +
  '©®—–…→←↑↓×÷°±' +
  'áéíóúüñçÁÉÍÓÚÜÑÇàèìòùâêîôûäëïöãõÀÈÌÒÙÂÊÎÔÛÄËÏÖÃÕ¿¡';

/**
 * The icons the interface actually renders, taken from the view modules
 * themselves rather than restated here.
 *
 * A parallel list would need keeping in step by hand, and the failure mode is
 * invisible: a glyph missing from the subset renders as an empty box, which no
 * test catches and no reviewer notices. Deriving it means the subset cannot
 * fall behind the code.
 */
const ICONS = [
  ...HEADLINE_ICON_GLYPHS,
  ...OPERATING_SYSTEM_ICON_GLYPHS,
  ...BROWSER_ICON_GLYPHS,
  ...DEVICE_ICON_GLYPHS,
].join('');

const source = process.argv[2] ?? DEFAULT_SOURCE;
const woff2 = await subsetFont(readFileSync(source), CHARSET + ICONS, { targetFormat: 'woff2' });

mkdirSync('assets/fonts', { recursive: true });
writeFileSync(OUTPUT, woff2);
console.log(`✔ ${OUTPUT} — ${(woff2.length / 1024).toFixed(1)} KB from ${source}`);

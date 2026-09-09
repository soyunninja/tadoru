/**
 * A small icon for the browser breakdown.
 *
 * Nerd Font glyphs from the Font Awesome brand range (U+F000-U+F2FF), which
 * the bundled subset ships and the CC BY 4.0 attribution in
 * assets/fonts/NOTICE.md covers. There is no list to keep in step:
 * scripts/build-font.ts imports the exported glyph list below, so an icon added
 * here reaches the bundled font on the next `npm run build:font`.
 */
const ICONS: ReadonlyArray<readonly [pattern: RegExp, icon: string]> = [
  [/^chrom/, '\u{f268}'], // chrome, and Chromium-family clients
  [/^firefox/, '\u{f269}'],
  [/^safari/, '\u{f267}'],
  [/^opera/, '\u{f26a}'],
  [/^edge/, '\u{f282}'],
  // node-device-detector groups Edge under the Internet Explorer family, so
  // this arm matches far more real traffic than the name suggests.
  [/^internet explorer/, '\u{f26b}'],
];

/** Exported so scripts/build-font.ts derives the subset from the code. */
export const BROWSER_ICON_GLYPHS: readonly string[] = ICONS.map(([, glyph]) => glyph);


/** The icon for a browser family, or an empty string when none fits. */
export function browserIcon(family: string): string {
  const normalized = family.trim().toLowerCase();
  if (normalized.length === 0) return '';

  for (const [pattern, icon] of ICONS) {
    if (pattern.test(normalized)) return icon;
  }
  // Better nothing than a wrong mark: plenty of clients are neither browsers
  // nor recognisable, and curl is not Chrome.
  return '';
}

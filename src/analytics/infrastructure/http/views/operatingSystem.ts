/**
 * A small icon for the operating-system breakdown.
 *
 * These are Nerd Font glyphs from the Font Awesome brand range
 * (U+F000-U+F2FF), which the bundled subset ships and which the CC BY 4.0
 * attribution in assets/fonts/NOTICE.md already covers.
 *
 * The Font Logos set (U+F300 and above) has nicer distribution marks, but the
 * Nerd Fonts licence audit records it as unlicensed, so it is deliberately
 * avoided: an icon is not worth redistributing artwork on unknown terms.
 *
 * The matched strings are the exact families `node-device-detector` emits,
 * confirmed against real user agents, plus a few distribution names in case a
 * future change surfaces the name instead of the family.
 *
 * There is no list to keep in step: scripts/build-font.ts imports the exported
 * glyph list below, so an icon added here reaches the bundled font on the next
 * `npm run build:font`.
 */
const ICONS: ReadonlyArray<readonly [pattern: RegExp, icon: string]> = [
  [/^(ios|ipados|mac|macos|os\s?x)$/, '\u{f179}'], // apple
  [/^windows/, '\u{f17a}'], // windows
  [/^android/, '\u{f17b}'], // android
  [/(linux|ubuntu|debian|fedora|arch|mint|suse|centos)/, '\u{f17c}'], // linux
  [/^chrome\s?os$/, '\u{f268}'], // chrome
];

/** Exported so scripts/build-font.ts derives the subset from the code. */
export const OPERATING_SYSTEM_ICON_GLYPHS: readonly string[] = ICONS.map(([, glyph]) => glyph);


/** The icon for an operating-system family, or an empty string when none fits. */
export function operatingSystemIcon(family: string): string {
  const normalized = family.trim().toLowerCase();
  if (normalized.length === 0) return '';

  for (const [pattern, icon] of ICONS) {
    if (pattern.test(normalized)) return icon;
  }
  // Better to show nothing than to guess wrong: a misleading icon is worse
  // than a plain name.
  return '';
}

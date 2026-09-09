/**
 * A small icon for the operating-system breakdown.
 *
 * Emoji rather than brand logos, deliberately: vendor logos are trademarks
 * whose redistribution inside an AGPL project carries conditions of its own,
 * and the dashboard's own content security policy blocks external images
 * anyway. An emoji needs no file, no icon font and no network request.
 *
 * The matched strings are the exact families `node-device-detector` emits,
 * confirmed against real user agents, plus a few distribution names in case a
 * future change surfaces the name instead of the family.
 */
const ICONS: ReadonlyArray<readonly [pattern: RegExp, icon: string]> = [
  [/^(ios|ipados|mac|macos|os\s?x)$/, '🍎'],
  [/^windows/, '🪟'],
  [/^android/, '🤖'],
  [/(linux|ubuntu|debian|fedora|arch|mint|suse|centos)/, '🐧'],
  [/^chrome\s?os$/, '🌐'],
];

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

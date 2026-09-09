import type { DeviceType } from '../../../domain/event/DeviceProfile.ts';

/**
 * A small icon for the device breakdown.
 *
 * Nerd Font glyphs from the Font Awesome range (U+F000-U+F2FF), covered by the
 * CC BY 4.0 attribution in assets/fonts/NOTICE.md. There is no list to keep in
 * step: scripts/build-font.ts imports the exported glyph list below.
 *
 * Typed against `DeviceType` rather than a bare string, so adding a device type
 * to the domain fails the build here instead of silently rendering nothing.
 */
const ICONS: Readonly<Record<DeviceType, string>> = {
  desktop: '\u{f108}',
  mobile: '\u{f10b}',
  tablet: '\u{f10a}',
  tv: '\u{f26c}',
  // Not a device anyone holds. A terminal reads as an automated client.
  bot: '\u{f120}',
  unknown: '',
};

/** Exported so scripts/build-font.ts derives the subset from the code. */
export const DEVICE_ICON_GLYPHS: readonly string[] = Object.values(ICONS).filter((g) => g !== '');


/** The icon for a device type, or an empty string when there is nothing to show. */
export function deviceIcon(type: string): string {
  return ICONS[type as DeviceType] ?? '';
}

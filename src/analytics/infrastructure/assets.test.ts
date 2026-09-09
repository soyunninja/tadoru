import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readBundledFont, fontUrlFor, BUNDLED_FONT, BUNDLED_FONT_URL } from './assets.ts';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { findPackageRoot } from './packageRoot.ts';
import { HEADLINE_ICON_GLYPHS } from './http/views/components.ts';
import { OPERATING_SYSTEM_ICON_GLYPHS } from './http/views/operatingSystem.ts';
import { BROWSER_ICON_GLYPHS } from './http/views/browser.ts';
import { DEVICE_ICON_GLYPHS } from './http/views/device.ts';

test('reads the real bundled font from the package root', () => {
  const font = readBundledFont();
  assert.ok(font !== null, 'the subset should ship with the package');
  assert.ok(font.length > 10_000, 'the real subset, not a stub');
  // WOFF2 files start with the signature "wOF2".
  assert.equal(font.subarray(0, 4).toString('ascii'), 'wOF2');
});

test('degrades to null when the package root cannot be found', () => {
  // A missing font is cosmetic; throwing here would take the server down at
  // boot over a typeface.
  assert.equal(readBundledFont({ findRoot: () => null }), null);
});

test('degrades to null when the file cannot be read', () => {
  const font = readBundledFont({
    findRoot: () => '/somewhere',
    readFile: () => {
      throw new Error('ENOENT');
    },
  });
  assert.equal(font, null);
});

// This is the invariant the whole caching design rests on. fontRoutes.ts serves
// the font with `max-age=31536000, immutable`, which is only safe because a
// changed file means a changed URL. If this ever returned a stable path for
// changed bytes, every browser that already fetched it would be stranded for a
// year — which is exactly how an earlier build shipped icons nobody could see.
test('the url changes whenever the bytes change', () => {
  assert.notEqual(fontUrlFor(Buffer.from('one')), fontUrlFor(Buffer.from('two')));
  // Even a single flipped byte must move the URL.
  assert.notEqual(fontUrlFor(Buffer.from('aaaa')), fontUrlFor(Buffer.from('aaab')));
});

test('the url is stable for identical bytes, so caching still works', () => {
  assert.equal(fontUrlFor(Buffer.from('same')), fontUrlFor(Buffer.from('same')));
});

test('the url carries a hex digest under /assets/', () => {
  assert.match(fontUrlFor(Buffer.from('x')), /^\/assets\/jetbrains-mono\.[0-9a-f]{12}\.woff2$/);
});

test('a missing font still yields a usable path rather than throwing', () => {
  assert.equal(fontUrlFor(null), '/assets/jetbrains-mono.woff2');
});

test('the module-level constants agree with each other', () => {
  // server.ts serves BUNDLED_FONT at a route derived from it, while layout.ts
  // references BUNDLED_FONT_URL in the stylesheet. If these two ever disagreed,
  // the stylesheet would point at a route nobody registered.
  assert.equal(BUNDLED_FONT_URL, fontUrlFor(BUNDLED_FONT));
});

test('every icon the interface emits is attributed in NOTICE.md', () => {
  // CC BY 4.0 requires attribution for each Font Awesome glyph redistributed in
  // the bundled subset. Prose drifts from code; this makes the obligation an
  // enforced property instead of a promise in a file nobody re-reads.
  const packageRoot = findPackageRoot(import.meta.url);
  assert.ok(packageRoot !== null);
  const notice = readFileSync(join(packageRoot, 'assets', 'fonts', 'NOTICE.md'), 'utf8');

  const emitted = new Set(
    [
      ...HEADLINE_ICON_GLYPHS,
      ...OPERATING_SYSTEM_ICON_GLYPHS,
      ...BROWSER_ICON_GLYPHS,
      ...DEVICE_ICON_GLYPHS,
    ].map((glyph) => `U+${glyph.codePointAt(0)?.toString(16).toUpperCase().padStart(4, '0')}`),
  );

  for (const codepoint of emitted) {
    assert.ok(notice.includes(codepoint), `${codepoint} is rendered but not attributed in NOTICE.md`);
  }
});

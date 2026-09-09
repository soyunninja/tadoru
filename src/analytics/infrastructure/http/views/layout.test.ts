import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderLayout, DEFAULT_REPOSITORY_URL } from './layout.ts';
import { html } from './escapeHtml.ts';

test('renderLayout produces a full HTML document with the given title and body', () => {
  const page = renderLayout({ title: 'Dashboard', body: html`<p>hello</p>`, version: '0.1.0' }).toString();
  assert.match(page, /^<!doctype html>/i);
  assert.match(page, /<title>Dashboard<\/title>/);
  assert.match(page, /<p>hello<\/p>/);
  assert.match(page, /<\/html>\s*$/);
});

test('renderLayout escapes the title', () => {
  const page = renderLayout({ title: '<script>alert(1)</script>', body: html``, version: '0.1.0' }).toString();
  assert.ok(!page.includes('<script>alert(1)</script>'));
  assert.match(page, /&lt;script&gt;/);
});

test('renderLayout includes a responsive viewport meta tag', () => {
  const page = renderLayout({ title: 'x', body: html``, version: '0.1.0' }).toString();
  assert.match(page, /<meta name="viewport" content="width=device-width, initial-scale=1">/);
});

test('renderLayout includes an inline style block, is dark-only, and has no script tags', () => {
  const page = renderLayout({ title: 'x', body: html``, version: '0.1.0' }).toString();
  assert.match(page, /<style>/);
  // Dark only, on purpose: the interface must look the same everywhere rather
  // than follow the operating system. `color-scheme: dark` is what makes the
  // browser paint native controls and scrollbars to match.
  assert.match(page, /color-scheme:\s*dark;/);
  assert.ok(!page.includes('prefers-color-scheme'), 'no light variant should remain');
  assert.ok(!page.includes('<script'));
});

test('renderLayout footer links to the project repository and shows the exact running version (AGPL network clause)', () => {
  const page = renderLayout({ title: 'x', body: html``, version: '1.2.3' }).toString();
  assert.match(page, new RegExp(`<a href="${DEFAULT_REPOSITORY_URL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*>`));
  assert.match(page, /1\.2\.3/);
});

test('renderLayout accepts a repositoryUrl override', () => {
  const page = renderLayout({
    title: 'x',
    body: html``,
    version: '1.2.3',
    repositoryUrl: 'https://example.com/repo',
  }).toString();
  assert.match(page, /https:\/\/example\.com\/repo/);
});

test('uses the locally installed JetBrains Mono Nerd Font when present', () => {
  const page = renderLayout({ title: 'x', body: html``, version: '0.1.0' }).toString();
  // The macOS family name for the Nerd-patched build is "JetBrainsMono NF" —
  // not "JetBrains Mono Nerd Font", which would silently fall back.
  assert.match(page, /"JetBrainsMono NF"/);
  // The fontconfig name the same cask registers on Linux.
  assert.match(page, /"JetBrainsMono Nerd Font"/);
});

test('monospace is scoped to data, and prose keeps the system face', () => {
  const page = renderLayout({ title: 'x', body: html``, version: '0.1.0' }).toString();
  // Digits and columns need to line up; paragraphs read better in the system face.
  assert.match(page, /--font-mono:/);
  assert.match(page, /--font-prose:/);
  assert.match(page, /table, \.headline \.value, code, pre, svg text \{ font-family: var\(--font-mono\); \}/);
  assert.match(page, /font-family: var\(--font-prose\);/);
});

test('the font stack always ends in a generic family', () => {
  // Nothing is fetched, so a machine without the font must still get something
  // sensible rather than the browser default.
  const page = renderLayout({ title: 'x', body: html``, version: '0.1.0' }).toString();
  assert.match(page, /monospace;/);
});

test('the icon span uses the bundled mono face, or its glyphs render as boxes', () => {
  const page = renderLayout({ title: 'x', body: html``, version: '0.1.0' }).toString();
  assert.match(page, /\.headline \.icon \{ font-family: var\(--font-mono\)/);
});

test('the web font is self-hosted, never fetched from a font CDN', () => {
  const page = renderLayout({ title: 'x', body: html``, version: '0.1.0' }).toString();
  // Shipping it means every operator gets the same typography. Fetching it from
  // Google Fonts or any other origin would breach AGENTS.md invariant 9.
  assert.match(page, /@font-face/);
  // Content-addressed, so a regenerated subset invalidates the cache.
  assert.match(page, /url\("\/assets\/jetbrains-mono\.[0-9a-f]{12}\.woff2"\)/);
  assert.ok(!/https?:\/\//.test(page.slice(page.indexOf('@font-face'), page.indexOf('@font-face') + 400)));
  // Text must stay visible while the font loads.
  assert.match(page, /font-display: swap/);
});

/** WCAG relative luminance, per the contrast formula. */
function luminance(hex: string): number {
  const channels = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * (channels[0] ?? 0) + 0.7152 * (channels[1] ?? 0) + 0.0722 * (channels[2] ?? 0);
}

function contrastRatio(a: string, b: string): number {
  const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((lighter ?? 0) + 0.05) / ((darker ?? 0) + 0.05);
}

function token(page: string, name: string): string {
  const match = page.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`));
  assert.ok(match, `token --${name} should be declared`);
  return (match as RegExpMatchArray)[1] as string;
}

test('the palette meets WCAG AA contrast, so a repaint cannot quietly break legibility', () => {
  const page = renderLayout({ title: 'x', body: html``, version: '0.1.0' }).toString();
  const bg = token(page, 'bg');
  const surface = token(page, 'surface');
  const fg = token(page, 'fg');
  const muted = token(page, 'muted');
  const accent = token(page, 'accent');

  assert.ok(contrastRatio(fg, surface) >= 4.5, `body text on a card: ${contrastRatio(fg, surface).toFixed(2)}:1`);
  assert.ok(contrastRatio(muted, surface) >= 4.5, `muted labels on a card: ${contrastRatio(muted, surface).toFixed(2)}:1`);
  assert.ok(contrastRatio(muted, bg) >= 4.5, `muted labels on the page: ${contrastRatio(muted, bg).toFixed(2)}:1`);
  // The accent paints link text, so it must clear the text threshold rather
  // than the looser graphical one.
  assert.ok(contrastRatio(accent, surface) >= 4.5, `accent text on a card: ${contrastRatio(accent, surface).toFixed(2)}:1`);
});

test('cards sit above the page background, never below it', () => {
  // Making the page lighter than its cards inverts the depth: the surfaces have
  // to move with it.
  const page = renderLayout({ title: 'x', body: html``, version: '0.1.0' }).toString();
  assert.ok(
    luminance(token(page, 'surface')) > luminance(token(page, 'bg')),
    'the card surface should be lighter than the page background',
  );
});

test('every surface separates from the page by colour alone, with no border', () => {
  const page = renderLayout({ title: 'x', body: html``, version: '0.1.0' }).toString();
  const card = page.slice(page.indexOf('.card {'), page.indexOf('.card h2'));
  assert.ok(!card.includes('border:'), 'the section card should carry no border');

  // KPI tiles and section cards are the same kind of surface; one bordered and
  // the other not reads as an accident.
  const tile = page.slice(page.indexOf('.headline .metric {'), page.indexOf('.headline .icon'));
  assert.ok(!tile.includes('border:'), 'the metric tile should carry no border either');
  // With the border gone, the surface step is the only thing separating a card
  // from the page, so it must stay perceptible.
  assert.ok(
    luminance(token(page, 'surface')) > luminance(token(page, 'bg')),
    'the card surface must remain lighter than the page',
  );
});

test('the metric icon has no surface behind it', () => {
  const page = renderLayout({ title: 'x', body: html``, version: '0.1.0' }).toString();
  const rule = page.slice(page.indexOf('.headline .icon {'), page.indexOf('.headline .value'));
  assert.ok(!rule.includes('background:'), 'the icon slot should sit directly on the card');
});

test('headline figures use the plain text colour, not the accent', () => {
  // The accent is reserved for links and the share bars; the figures are the
  // content, not a highlight.
  const page = renderLayout({ title: 'x', body: html``, version: '0.1.0' }).toString();
  const rule = page.slice(page.indexOf('.headline .value {'), page.indexOf('.headline .unit'));
  assert.ok(!rule.includes('color:'), 'the value should inherit the body colour');
});

test('the metric icon aligns with the figure, not with the middle of the tile', () => {
  const page = renderLayout({ title: 'x', body: html``, version: '0.1.0' }).toString();
  const rule = page.slice(page.indexOf('.headline .metric {'), page.indexOf('.headline .icon'));
  assert.match(rule, /align-items: flex-start/);
});

test('the <html> lang attribute defaults to English and follows the requested locale', () => {
  const defaultPage = renderLayout({ title: 'x', body: html``, version: '0.1.0' }).toString();
  assert.match(defaultPage, /^<!doctype html>\s*<html lang="en">/i);

  const spanishPage = renderLayout({ title: 'x', body: html``, version: '0.1.0', locale: 'es' }).toString();
  assert.match(spanishPage, /<html lang="es">/);

  const japanesePage = renderLayout({ title: 'x', body: html``, version: '0.1.0', locale: 'ja' }).toString();
  assert.match(japanesePage, /<html lang="ja">/);
});

test('the bundled font has no CJK glyphs, so both font stacks fall back to system CJK faces', () => {
  const page = renderLayout({ title: 'x', body: html``, version: '0.1.0' }).toString();
  for (const cjkFallback of ['Hiragino Sans', 'Noto Sans JP', 'Yu Gothic', 'Meiryo']) {
    const pattern = new RegExp(`"${cjkFallback}"|${cjkFallback}(?!["\\w])`);
    assert.match(page, pattern, `expected ${cjkFallback} in a font stack`);
  }
});

test('the footer sentence is translated per locale', () => {
  const spanish = renderLayout({ title: 'x', body: html``, version: '0.1.0', locale: 'es' }).toString();
  assert.match(spanish, /Tadoru es software libre:/);
  assert.match(spanish, /ver el código fuente correspondiente/);

  const japanese = renderLayout({ title: 'x', body: html``, version: '0.1.0', locale: 'ja' }).toString();
  assert.match(japanese, /Tadoru はフリーソフトウェアです：/);
  assert.match(japanese, /対応するソースコードを見る/);
});

test('every page carries the app name, with the Japanese reading marked as Japanese', () => {
  const page = renderLayout({ title: 'x', body: html``, version: '0.1.0' }).toString();
  assert.match(page, /<header class="brand">/);
  assert.match(page, /tadoru/);
  // The lang attribute is what makes the browser pick a Japanese face for the
  // kana. The bundled font subset has no CJK glyphs, so without it the kana
  // fall to whatever the Latin stack happens to resolve to.
  assert.match(page, /<span class="brand-jp" lang="ja">たどる<\/span>/);
});

test('the Japanese badge is legible: black on white', () => {
  const page = renderLayout({ title: 'x', body: html``, version: '0.1.0' }).toString();
  const rule = page.slice(page.indexOf('.brand-jp {'), page.indexOf('}', page.indexOf('.brand-jp {')));
  assert.match(rule, /background: #ffffff/);
  assert.match(rule, /color: #000000/);
  assert.match(rule, /border-radius/);
  assert.equal(contrastRatio('#000000', '#ffffff').toFixed(0), '21');
});

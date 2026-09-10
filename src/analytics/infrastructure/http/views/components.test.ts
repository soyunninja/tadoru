import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { MetricRow } from '../../../domain/report/Metrics.ts';
import { HEADLINE_ICON_GLYPHS } from './components.ts';
import { OPERATING_SYSTEM_ICON_GLYPHS } from './operatingSystem.ts';
import { BROWSER_ICON_GLYPHS } from './browser.ts';
import { DEVICE_ICON_GLYPHS } from './device.ts';
import {
  sumMetricRows,
  bounceRate,
  averageEngagementSeconds,
  labelForKey,
  renderHeadline,
  renderBreakdownTable,
  renderVisitorChart,
  renderLogoutForm,
  renderTrackingSnippet,
} from './components.ts';

function row(overrides: Partial<MetricRow> & { key: string }): MetricRow {
  return { pageviews: 0, visitors: 0, sessions: 0, bounces: 0, engagementSeconds: 0, ...overrides };
}

test('sumMetricRows sums every field across rows', () => {
  const rows = [
    row({ key: 'a', pageviews: 2, visitors: 1, sessions: 1, bounces: 1, engagementSeconds: 10 }),
    row({ key: 'b', pageviews: 3, visitors: 2, sessions: 2, bounces: 0, engagementSeconds: 20 }),
  ];
  assert.deepEqual(sumMetricRows(rows), {
    pageviews: 5,
    visitors: 3,
    sessions: 3,
    bounces: 1,
    engagementSeconds: 30,
  });
});

test('sumMetricRows on an empty list is all zero', () => {
  assert.deepEqual(sumMetricRows([]), { pageviews: 0, visitors: 0, sessions: 0, bounces: 0, engagementSeconds: 0 });
});

test('bounceRate is bounces/sessions, and 0 when sessions is 0', () => {
  assert.equal(bounceRate({ pageviews: 0, visitors: 0, sessions: 4, bounces: 1, engagementSeconds: 0 }), 0.25);
  assert.equal(bounceRate({ pageviews: 0, visitors: 0, sessions: 0, bounces: 0, engagementSeconds: 0 }), 0);
});

test('averageEngagementSeconds is engagementSeconds/sessions, and 0 when sessions is 0', () => {
  assert.equal(
    averageEngagementSeconds({ pageviews: 0, visitors: 0, sessions: 2, bounces: 0, engagementSeconds: 100 }),
    50,
  );
  assert.equal(
    averageEngagementSeconds({ pageviews: 0, visitors: 0, sessions: 0, bounces: 0, engagementSeconds: 0 }),
    0,
  );
});

test('labelForKey shows "Direct" for an empty referrer and a readable label for other empty dimensions', () => {
  assert.equal(labelForKey('referrer', ''), 'Direct');
  assert.equal(labelForKey('country', ''), '(unknown)');
  assert.notEqual(labelForKey('path', '/about'), '');
  assert.equal(labelForKey('path', '/about'), '/about');
});

test('renderHeadline includes the five headline numbers and the visitor-summing caveat', () => {
  const html = renderHeadline({ pageviews: 10, visitors: 4, sessions: 5, bounces: 1, engagementSeconds: 100 }).toString();
  assert.match(html, />4</);
  assert.match(html, />10</);
  assert.match(html, />5</);
  // The unit is its own element now, so the percentage renders as "20.0" plus
  // a "%" marker rather than one string.
  assert.match(html, /20\.0/);
  assert.match(html, /<span class="unit">%<\/span>/);
  assert.match(html, /0:20/);
  // Collapsed by default: the question is visible, the answer is one click away.
  // Escaped, not raw — the apostrophe arrives as &#39;, which the browser renders
  // as an apostrophe. Passing catalogue text through raw() would buy nothing and
  // leave an injection hole open for the day translations stop being hardcoded.
  assert.match(html, /<details class="caveat">/);
  assert.match(html, /<summary>Why don&#39;t the tables match these totals\?<\/summary>/);
  // A worked example beats a definition: the explanation names a person and
  // walks through what she did.
  assert.match(html, /Ana visits your site/);
  assert.match(html, /gives more than the total above/);
});

test('renderBreakdownTable escapes an attacker-controlled key', () => {
  const rows: MetricRow[] = [row({ key: '"><script>alert(1)</script>', visitors: 1, pageviews: 1 })];
  const out = renderBreakdownTable('Top pages', 'path', rows).toString();
  assert.ok(!out.includes('<script>alert(1)</script>'));
  assert.match(out, /&lt;script&gt;/);
});

test('renderBreakdownTable renders a readable empty state for no rows', () => {
  const out = renderBreakdownTable('Referrers', 'referrer', []).toString();
  assert.match(out, /no data/i);
});

test('renderBreakdownTable labels an empty referrer key as Direct instead of a blank cell', () => {
  const rows: MetricRow[] = [row({ key: '', visitors: 3, pageviews: 3 })];
  const out = renderBreakdownTable('Referrers', 'referrer', rows).toString();
  assert.match(out, /Direct/);
});

test('renderVisitorChart includes an accessible role, a title, and a text-equivalent table', () => {
  const out = renderVisitorChart([
    { date: '2026-01-01', visitors: 3 },
    { date: '2026-01-02', visitors: 5 },
  ]).toString();
  assert.match(out, /role="img"/);
  assert.match(out, /<title>/);
  assert.match(out, /<table>/);
  assert.match(out, /2026-01-01/);
  assert.match(out, />3</);
  assert.match(out, />5</);
});

test('renderVisitorChart escapes date text placed into SVG nodes', () => {
  const out = renderVisitorChart([{ date: '"><script>xss</script>', visitors: 1 }]).toString();
  assert.ok(!out.includes('<script>xss</script>'));
});

test('renderLogoutForm is a plain POST form with no script', () => {
  const out = renderLogoutForm().toString();
  assert.match(out, /<form method="post" action="\/logout"/);
  assert.ok(!out.includes('<script'));
});

/** Strips real HTML tags (the syntax-highlighting spans, <pre>, <code>, ...) to get back the plain visible text, leaving already-escaped entities (e.g. "&lt;") untouched since those are text, not markup. */
function visibleText(markup: string): string {
  return markup.replace(/<[^>]+>/g, '');
}

test('renderTrackingSnippet displays the documented script tag plus noscript pixel fallback as escaped, copyable text (never as a live element built from the host — the page CSP only allows the fixed copy-button script)', () => {
  const out = renderTrackingSnippet('tadoru.example.com', true).toString();
  const text = visibleText(out);
  // The escaped form is what a browser renders back as readable,
  // copy-pasteable text for the operator to paste into their own site.
  assert.match(text, /&lt;script defer src="https:\/\/tadoru\.example\.com\/t\.js"&gt;&lt;\/script&gt;/);
  assert.match(
    text,
    /&lt;noscript&gt;&lt;img src="https:\/\/tadoru\.example\.com\/t\.gif" alt="" width="1" height="1"&gt;&lt;\/noscript&gt;/,
  );
  // The literal characters "<script defer" or "<noscript>" must never appear
  // as real markup (that would mean the displayed snippet text turned into a
  // live element). The one real <script> tag in the output is the fixed,
  // developer-authored copy-button behaviour, asserted separately below.
  assert.ok(!out.includes('<script defer'));
  assert.ok(!out.includes('<noscript>'));
});

test('renderTrackingSnippet uses http when the request was not secure', () => {
  const out = renderTrackingSnippet('localhost:8080', false).toString();
  assert.match(visibleText(out), /http:\/\/localhost:8080\/t\.js/);
});

test('renderTrackingSnippet escapes an attacker-controlled Host header', () => {
  const out = renderTrackingSnippet('"><script>alert(1)</script>', true).toString();
  assert.ok(!out.includes('<script>alert(1)</script>'));
  // The hostile value must show up only as escaped entities, composed via the
  // `html` tag's normal interpolation — never unwrapped by a post-hoc raw().
  assert.match(out, /&quot;&gt;&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
});

test('renderTrackingSnippet renders IDE-style syntax highlighting for tag names, attribute names, string values and punctuation', () => {
  const out = renderTrackingSnippet('tadoru.example.com', true).toString();
  assert.match(out, /<span class="tag">script<\/span>/);
  assert.match(out, /<span class="tag">noscript<\/span>/);
  assert.match(out, /<span class="tag">img<\/span>/);
  assert.match(out, /<span class="attr">defer<\/span>/);
  assert.match(out, /<span class="attr">src<\/span>/);
  assert.match(out, /<span class="string">"https:\/\/tadoru\.example\.com\/t\.js"<\/span>/);
  assert.match(out, /<span class="punct">/);
});

test('renderTrackingSnippet keeps the full snippet as plain selectable text in the DOM, not hidden behind the copy button', () => {
  const out = renderTrackingSnippet('tadoru.example.com', true).toString();
  assert.match(out, /<code id="[^"]+">[\s\S]*<\/code>/);
  // The snippet text itself is present outside of any [hidden]/display:none
  // wrapper — the copy button is an addition, not a reveal gate.
  const codeMatch = out.match(/<code id="[^"]+">([\s\S]*?)<\/code>/);
  assert.ok(codeMatch);
  assert.ok(!(codeMatch?.[1] ?? '').includes('hidden'));
});

test('renderTrackingSnippet includes a copy button labelled per locale, with a copied-confirmation slot, wired to the fixed inline script by a static id', () => {
  const enOut = renderTrackingSnippet('tadoru.example.com', true, 'en').toString();
  assert.match(enOut, /<button type="button" class="copy-button"[^>]*>Copy<\/button>/);
  assert.match(enOut, /data-copied-text="Copied!"/);

  const esOut = renderTrackingSnippet('tadoru.example.com', true, 'es').toString();
  assert.match(esOut, /<button type="button" class="copy-button"[^>]*>Copiar<\/button>/);
  assert.match(esOut, /data-copied-text="¡Copiado!"/);

  const jaOut = renderTrackingSnippet('tadoru.example.com', true, 'ja').toString();
  assert.match(jaOut, />コピー<\/button>/);
  assert.match(jaOut, /data-copied-text="コピーしました"/);
});

test('renderTrackingSnippet emits the fixed copy-button script exactly once', () => {
  const out = renderTrackingSnippet('tadoru.example.com', true).toString();
  const scriptOccurrences = out.split('<script>').length - 1;
  assert.equal(scriptOccurrences, 1);
});

test('the country table shows a flag and the country name, not a bare ISO code', () => {
  const html = renderBreakdownTable('Countries', 'country', [
    { key: 'ES', visitors: 10, pageviews: 20, sessions: 10, bounces: 3, engagementSeconds: 100 },
  ]).toString();
  assert.match(html, /🇪🇸/);
  assert.match(html, /Spain/);
});

// The name sits right beside it, so a screen reader announcing "flag of Spain
// Spain" is noise. The flag is decoration; the name carries the meaning.
test('the flag is hidden from assistive technology', () => {
  const html = renderBreakdownTable('Countries', 'country', [
    { key: 'ES', visitors: 1, pageviews: 1, sessions: 1, bounces: 0, engagementSeconds: 0 },
  ]).toString();
  assert.match(html, /aria-hidden="true"[^>]*>🇪🇸/);
});

test('an unlocatable visitor gets no nonsense flag', () => {
  const html = renderBreakdownTable('Countries', 'country', [
    { key: 'XX', visitors: 1, pageviews: 1, sessions: 1, bounces: 0, engagementSeconds: 0 },
  ]).toString();
  assert.ok(!html.includes('🇽🇽'));
  assert.match(html, /Unknown/);
});

test('the operating system table shows an icon beside the name', () => {
  const html = renderBreakdownTable('Operating systems', 'os', [
    { key: 'GNU/Linux', visitors: 5, pageviews: 9, sessions: 5, bounces: 1, engagementSeconds: 50 },
  ]).toString();
  assert.match(html, /aria-hidden="true"[^>]*>\u{f17c}/u);
  assert.match(html, /GNU\/Linux/);
});

test('other dimensions are left undecorated', () => {
  const html = renderBreakdownTable('Top pages', 'path', [
    { key: '/blog/post', visitors: 3, pageviews: 4, sessions: 3, bounces: 1, engagementSeconds: 30 },
  ]).toString();
  // The share bar is aria-hidden on every row, so assert the real intent:
  // no country flag and no operating-system icon on an unrelated dimension.
  assert.ok(!/aria-hidden="true">[^<]*[\u{1F1E6}-\u{1F1FF}\u{1F300}-\u{1FAFF}]/u.test(html));
  assert.match(html, /\/blog\/post/);
});

test('numeric columns are marked so digits align instead of ragging left', () => {
  const html = renderBreakdownTable('Top pages', 'path', [
    { key: '/a', visitors: 7, pageviews: 1234, sessions: 7, bounces: 1, engagementSeconds: 10 },
  ]).toString();
  // Both the header and the cell, or the column still looks crooked.
  // 'path' leads with pageviews, so Pageviews is the first figure here and
  // Visitors takes the fixed-width anchor column on the right.
  assert.match(html, /<th class="num">Pageviews<\/th>/);
  assert.match(html, /<th class="num num-last">Visitors<\/th>/);
  // Grouped per locale (English here) via Intl.NumberFormat, not a bare "1234".
  assert.match(html, /<td class="num">1,234<\/td>/);
  assert.match(html, /<td class="num num-last">7<\/td>/);
});

test('the first column header is hidden on screen but still announced, with a translated label', () => {
  // The card heading already names the column visually, so repeating it is
  // noise — but removing it outright leaves a data column unlabelled for
  // screen readers. The label comes from the message catalogue, keyed by
  // dimension, so it stays translated too.
  const html = renderBreakdownTable('Top pages', 'path', [
    { key: '/a', visitors: 1, pageviews: 1, sessions: 1, bounces: 0, engagementSeconds: 0 },
  ]).toString();
  assert.match(html, /<th><span class="sr-only">Top pages<\/span><\/th>/);
});

test('a row without an icon still reserves the marker slot, so labels line up', () => {
  // 'Symbian' has no icon. Without the empty slot its label would start 25px
  // left of every other row in the same table.
  const html = renderBreakdownTable('Operating systems', 'os', [
    { key: 'GNU/Linux', visitors: 5, pageviews: 5, sessions: 5, bounces: 0, engagementSeconds: 0 },
    { key: 'Symbian', visitors: 1, pageviews: 1, sessions: 1, bounces: 0, engagementSeconds: 0 },
  ]).toString();
  assert.equal((html.match(/<span class="marker"/g) ?? []).length, 2);
  assert.match(html, /<span class="marker" aria-hidden="true"><\/span>Symbian/);
});

test('an unlocatable country reserves the slot too', () => {
  const html = renderBreakdownTable('Countries', 'country', [
    { key: 'XX', visitors: 1, pageviews: 1, sessions: 1, bounces: 0, engagementSeconds: 0 },
  ]).toString();
  assert.match(html, /<span class="marker" aria-hidden="true"><\/span>Unknown/);
});

test('dimensions with no marker at all render no slot', () => {
  // Reserving 25px in front of every page path would just be a wasted indent.
  const html = renderBreakdownTable('Top pages', 'path', [
    { key: '/blog/post', visitors: 1, pageviews: 1, sessions: 1, bounces: 0, engagementSeconds: 0 },
  ]).toString();
  assert.ok(!html.includes('class="marker"'));
});

test('labelForKey translates the empty-key placeholder per locale', () => {
  assert.equal(labelForKey('referrer', '', 'es'), 'Directo');
  assert.equal(labelForKey('country', '', 'ja'), '（不明）');
});

test('renderHeadline translates its labels and localises its numbers', () => {
  const html = renderHeadline(
    { pageviews: 1000, visitors: 4, sessions: 5, bounces: 1, engagementSeconds: 100 },
    'es',
  ).toString();
  assert.match(html, /Visitantes/);
  assert.match(html, /Páginas vistas/);
  assert.match(html, /Sesiones/);
  assert.match(html, /Tasa de rebote/);
  assert.match(html, /Interacción media/);
  assert.match(html, /¿Por qué las tablas no cuadran con estos totales\?/);
  // Spanish groups thousands with a period.
  assert.match(html, /1\.000/);
  // The bounce rate (20%) uses a comma decimal separator in Spanish.
  assert.match(html, /20,0/);
});

test('renderBreakdownTable translates the empty-range message and the column headers', () => {
  const empty = renderBreakdownTable('Referrers', 'referrer', [], 'ja').toString();
  assert.match(empty, /この範囲のデータはありません。/);

  const withRows = renderBreakdownTable('Referrers', 'referrer', [
    { key: '', visitors: 3, pageviews: 3, sessions: 3, bounces: 0, engagementSeconds: 0 },
  ], 'ja').toString();
  assert.match(withRows, /直接アクセス/);
  assert.match(withRows, /<th class="num">訪問者数<\/th>/);
});

test('renderBreakdownTable shows the country name in the requested locale', () => {
  const html = renderBreakdownTable('Countries', 'country', [
    { key: 'ES', visitors: 1, pageviews: 1, sessions: 1, bounces: 0, engagementSeconds: 0 },
  ], 'ja').toString();
  assert.match(html, /スペイン/);
});

test('renderVisitorChart translates its accessible text and table headers, keeping the ISO date machine-readable', () => {
  const html = renderVisitorChart([{ date: '2026-01-01', visitors: 3 }], 'ja').toString();
  assert.match(html, /aria-label="日別訪問者数"/);
  assert.match(html, /<summary>日別訪問者数（表）<\/summary>/);
  assert.match(html, /<th>日付<\/th><th>訪問者数<\/th>/);
  // Machine-readable ISO date preserved in a `datetime` attribute...
  assert.match(html, /<time datetime="2026-01-01">/);
  // ...while the visible label is localised.
  assert.match(html, /<time datetime="2026-01-01">2026\/01\/01<\/time>/);
});

test('renderVisitorChart translates the empty-chart message', () => {
  const html = renderVisitorChart([], 'es').toString();
  assert.match(html, /No hay datos para graficar\./);
});

test('renderLogoutForm translates its button label', () => {
  assert.match(renderLogoutForm('es').toString(), />Cerrar sesión</);
  assert.match(renderLogoutForm('ja').toString(), />ログアウト</);
});

test('locale defaults to English when omitted, so existing callers are unaffected', () => {
  assert.match(renderLogoutForm().toString(), />Log out</);
});

test('top pages leads with pageviews and is sorted by them, matching its own title', () => {
  // Pageviews are additive: each one belongs to exactly one page, so this
  // column really does sum to the headline total. Visitors do not.
  const html = renderBreakdownTable('Top pages', 'path', [
    { key: '/few-views-many-people', visitors: 90, pageviews: 100, sessions: 90, bounces: 0, engagementSeconds: 0 },
    { key: '/many-views-few-people', visitors: 10, pageviews: 500, sessions: 10, bounces: 0, engagementSeconds: 0 },
  ]).toString();
  assert.ok(
    html.indexOf('/many-views-few-people') < html.indexOf('/few-views-many-people'),
    'the most viewed page should come first on a "most viewed" table',
  );
});

test('other dimensions still lead with visitors', () => {
  const html = renderBreakdownTable('Countries', 'country', [
    { key: 'ES', visitors: 10, pageviews: 500, sessions: 10, bounces: 0, engagementSeconds: 0 },
    { key: 'FR', visitors: 90, pageviews: 100, sessions: 90, bounces: 0, engagementSeconds: 0 },
  ]).toString();
  assert.match(html, /<th class="num">Visitors<\/th>/);
  assert.ok(html.indexOf('France') < html.indexOf('Spain'), 'sorted by visitors, not pageviews');
});

test('every icon the interface renders sits in the attributed licence range', () => {
  // scripts/build-font.ts derives the font subset from these same exports, so
  // an icon added to a view module reaches the bundled font automatically.
  // What it cannot check is licensing: Font Logos (U+F300 and above) is
  // recorded as unlicensed in the Nerd Fonts audit, and only U+F000-U+F2FF is
  // covered by the CC BY 4.0 attribution in assets/fonts/NOTICE.md.
  const everyGlyph = [
    ...HEADLINE_ICON_GLYPHS,
    ...OPERATING_SYSTEM_ICON_GLYPHS,
    ...BROWSER_ICON_GLYPHS,
    ...DEVICE_ICON_GLYPHS,
  ];
  assert.ok(everyGlyph.length > 0, 'the interface should render some icons');
  for (const glyph of everyGlyph) {
    const codepoint = glyph.codePointAt(0);
    assert.ok(
      codepoint !== undefined && codepoint >= 0xf000 && codepoint <= 0xf2ff,
      `U+${codepoint?.toString(16)} falls outside the attributed range`,
    );
  }
});

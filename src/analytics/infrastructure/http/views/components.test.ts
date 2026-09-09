import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { MetricRow } from '../../../domain/report/Metrics.ts';
import {
  sumMetricRows,
  bounceRate,
  averageEngagementSeconds,
  formatDuration,
  formatPercent,
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

test('formatDuration renders m:ss', () => {
  assert.equal(formatDuration(0), '0:00');
  assert.equal(formatDuration(5), '0:05');
  assert.equal(formatDuration(65), '1:05');
  assert.equal(formatDuration(600), '10:00');
});

test('formatPercent renders one decimal place with a % sign', () => {
  assert.equal(formatPercent(0), '0.0%');
  assert.equal(formatPercent(0.5), '50.0%');
  assert.equal(formatPercent(1), '100.0%');
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
  assert.match(html, /20\.0%/);
  assert.match(html, /0:20/);
  assert.match(html, /won't match the total above/);
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

test('renderTrackingSnippet displays the documented script tag plus noscript pixel fallback as escaped, copyable text (never as a live element — the page CSP forbids scripts)', () => {
  const out = renderTrackingSnippet('tadoru.example.com', true).toString();
  // The literal characters "<script" must never appear (that would be a live
  // element); the escaped form is what a browser renders back as readable,
  // copy-pasteable text for the operator to paste into their own site.
  assert.ok(!out.includes('<script'));
  assert.match(out, /&lt;script defer src="https:\/\/tadoru\.example\.com\/t\.js"&gt;&lt;\/script&gt;/);
  assert.match(
    out,
    /&lt;noscript&gt;&lt;img src="https:\/\/tadoru\.example\.com\/t\.gif" alt="" width="1" height="1"&gt;&lt;\/noscript&gt;/,
  );
});

test('renderTrackingSnippet uses http when the request was not secure', () => {
  const out = renderTrackingSnippet('localhost:8080', false).toString();
  assert.match(out, /http:\/\/localhost:8080\/t\.js/);
});

test('renderTrackingSnippet escapes an attacker-controlled Host header', () => {
  const out = renderTrackingSnippet('"><script>alert(1)</script>', true).toString();
  assert.ok(!out.includes('<script>alert(1)</script>'));
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
  assert.match(html, /aria-hidden="true"[^>]*>🐧/);
  assert.match(html, /GNU\/Linux/);
});

test('other dimensions are left undecorated', () => {
  const html = renderBreakdownTable('Top pages', 'path', [
    { key: '/blog/post', visitors: 3, pageviews: 4, sessions: 3, bounces: 1, engagementSeconds: 30 },
  ]).toString();
  assert.ok(!html.includes('aria-hidden'));
  assert.match(html, /\/blog\/post/);
});

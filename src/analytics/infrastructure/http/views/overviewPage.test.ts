import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { MetricRow } from '../../../domain/report/Metrics.ts';
import { renderOverviewPage } from './overviewPage.ts';

function row(key: string, visitors: number, pageviews = visitors): MetricRow {
  return { key, visitors, pageviews, sessions: visitors, bounces: 0, engagementSeconds: visitors * 30 };
}

const emptyBreakdowns = {
  path: [] as readonly MetricRow[],
  referrer: [] as readonly MetricRow[],
  country: [] as readonly MetricRow[],
  device: [] as readonly MetricRow[],
  browser: [] as readonly MetricRow[],
  os: [] as readonly MetricRow[],
  campaign: [] as readonly MetricRow[],
};

function baseOptions(overrides: Partial<Parameters<typeof renderOverviewPage>[0]> = {}) {
  return {
    site: 'example.com',
    range: '7d' as const,
    totals: { pageviews: 0, visitors: 0, sessions: 0, bounces: 0, engagementSeconds: 0 },
    dailyVisitors: [],
    breakdowns: emptyBreakdowns,
    version: '0.1.0',
    ...overrides,
  };
}

test('renderOverviewPage shows an honest empty state when there is no data at all', () => {
  const page = renderOverviewPage(baseOptions()).toString();
  assert.match(page, /check that the tracking snippet is installed/i);
  assert.match(page, /\/dashboard/);
  assert.ok(!page.includes('<svg'));
});

test('renderOverviewPage renders headline totals, chart and breakdown tables when data exists', () => {
  const page = renderOverviewPage(
    baseOptions({
      totals: { pageviews: 10, visitors: 4, sessions: 5, bounces: 1, engagementSeconds: 150 },
      dailyVisitors: [{ date: '2026-01-01', visitors: 4 }],
      breakdowns: {
        ...emptyBreakdowns,
        path: [row('/about', 2)],
        device: [row('desktop', 4)],
      },
    }),
  ).toString();

  assert.match(page, /<svg/);
  assert.match(page, /\/about/);
  assert.match(page, /desktop/);
  assert.match(page, />4</); // visitors headline
});

test('renderOverviewPage escapes the site name (defense in depth even though sites are configured, not attacker-supplied)', () => {
  const page = renderOverviewPage(baseOptions({ site: '<script>alert(1)</script>' })).toString();
  assert.ok(!page.includes('<script>alert(1)</script>'));
});

test('renderOverviewPage offers a range selector covering 7d, 30d, 12m and today', () => {
  // The currently-selected range is shown as plain text rather than a link
  // to itself, so pick '30d' as current and expect links for the other three.
  const page = renderOverviewPage(baseOptions({ range: '30d' })).toString();
  assert.match(page, /range=7d/);
  assert.match(page, /range=12m/);
  assert.match(page, /range=today/);
  assert.match(page, />30 days</);
});

test('renderOverviewPage includes a logout form and no script tags', () => {
  const page = renderOverviewPage(baseOptions()).toString();
  assert.match(page, /<form method="post" action="\/logout"/);
  assert.ok(!page.includes('<script'));
});

test('renderOverviewPage links back to /dashboard', () => {
  const page = renderOverviewPage(baseOptions()).toString();
  assert.match(page, /href="\/dashboard"/);
});

test('campaigns lead the breakdowns, ahead of pages and referrers', () => {
  // With no data at all the page renders its empty state instead of tables,
  // so the ordering can only be observed once there is something to order.
  const page = renderOverviewPage(
    baseOptions({
      totals: { pageviews: 4, visitors: 2, sessions: 2, bounces: 1, engagementSeconds: 60 },
      breakdowns: {
        ...emptyBreakdowns,
        path: [row('/', 2)],
        campaign: [row('lanzamiento', 2)],
      },
    }),
  ).toString();
  const campaignsAt = page.indexOf('Campaigns');
  const pagesAt = page.indexOf('Top pages');
  assert.ok(campaignsAt !== -1 && pagesAt !== -1, 'both sections should render');
  assert.ok(campaignsAt < pagesAt, 'Campaigns should come first');
});

test('renderOverviewPage translates the section titles, range labels and page title', () => {
  const page = renderOverviewPage(
    baseOptions({
      range: '30d',
      totals: { pageviews: 4, visitors: 2, sessions: 2, bounces: 1, engagementSeconds: 60 },
      breakdowns: { ...emptyBreakdowns, path: [row('/', 2)] },
      locale: 'es',
    }),
  ).toString();
  assert.match(page, /<title>example\.com — Tadoru<\/title>/);
  assert.match(page, /Páginas más vistas/);
  assert.match(page, />30 días</);
  assert.match(page, /Todos los sitios/);
});

test('renderOverviewPage translates the empty-state sentence', () => {
  const page = renderOverviewPage(baseOptions({ locale: 'ja' })).toString();
  assert.match(page, /この範囲のデータはまだありません。/);
  assert.match(page, /サイト一覧ページ/);
});

test('renderOverviewPage passes the current locale and URL down to the shared layout', () => {
  const page = renderOverviewPage(
    baseOptions({ locale: 'ja', currentUrl: '/dashboard/example.com?range=7d' }),
  ).toString();
  assert.match(page, /<html lang="ja">/);
  assert.match(page, /lang=ja/);
});

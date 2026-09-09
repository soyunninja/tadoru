import { html } from './escapeHtml.ts';
import type { SafeHtml } from './escapeHtml.ts';
import type { MetricRow } from '../../../domain/report/Metrics.ts';
import { renderLayout } from './layout.ts';
import {
  renderHeadline,
  renderBreakdownTable,
  renderVisitorChart,
  renderLogoutForm,
  type HeadlineTotals,
  type DailyVisitors,
} from './components.ts';

export type RangeKey = '7d' | '30d' | '12m' | 'today';

const RANGE_LABELS: Readonly<Record<RangeKey, string>> = {
  today: 'Today',
  '7d': '7 days',
  '30d': '30 days',
  '12m': '12 months',
};

const RANGE_ORDER: readonly RangeKey[] = ['today', '7d', '30d', '12m'];

export interface OverviewPageBreakdowns {
  readonly path: readonly MetricRow[];
  readonly referrer: readonly MetricRow[];
  readonly country: readonly MetricRow[];
  readonly device: readonly MetricRow[];
  readonly browser: readonly MetricRow[];
  readonly os: readonly MetricRow[];
  readonly campaign: readonly MetricRow[];
}

export interface OverviewPageOptions {
  readonly site: string;
  readonly range: RangeKey;
  readonly totals: HeadlineTotals;
  readonly dailyVisitors: readonly DailyVisitors[];
  readonly breakdowns: OverviewPageBreakdowns;
  readonly version: string;
  readonly repositoryUrl?: string;
}

function rangeSelector(site: string, current: RangeKey): SafeHtml {
  const links = RANGE_ORDER.map((key) => {
    const label = RANGE_LABELS[key];
    if (key === current) {
      return html`<strong>${label}</strong>`;
    }
    return html`<a href="/dashboard/${site}?range=${key}">${label}</a>`;
  });
  return html`<nav class="muted">${links.map((link, index) => (index === 0 ? link : html` · ${link}`))}</nav>`;
}

function hasAnyData(options: OverviewPageOptions): boolean {
  const { totals, breakdowns } = options;
  const totalsAreZero =
    totals.visitors === 0 && totals.pageviews === 0 && totals.sessions === 0 && totals.bounces === 0;
  const breakdownsAreEmpty =
    breakdowns.path.length === 0 &&
    breakdowns.referrer.length === 0 &&
    breakdowns.country.length === 0 &&
    breakdowns.device.length === 0 &&
    breakdowns.browser.length === 0 &&
    breakdowns.os.length === 0 &&
    breakdowns.campaign.length === 0;
  return !(totalsAreZero && breakdownsAreEmpty);
}

export function renderOverviewPage(options: OverviewPageOptions): SafeHtml {
  const { site, breakdowns } = options;

  const header = html`<p><a href="/dashboard">&larr; All sites</a></p>
<h1>${site}</h1>
${rangeSelector(site, options.range)}`;

  const content = hasAnyData(options)
    ? html`${renderHeadline(options.totals)}
${renderVisitorChart(options.dailyVisitors)}
${renderBreakdownTable('Top pages', 'path', breakdowns.path)}
${renderBreakdownTable('Referrer sources', 'referrer', breakdowns.referrer)}
${renderBreakdownTable('Countries', 'country', breakdowns.country)}
${renderBreakdownTable('Devices', 'device', breakdowns.device)}
${renderBreakdownTable('Browsers', 'browser', breakdowns.browser)}
${renderBreakdownTable('Operating systems', 'os', breakdowns.os)}
${renderBreakdownTable('Campaigns', 'campaign', breakdowns.campaign)}`
    : html`<p>No data yet for this site in this range. Check that the tracking snippet is installed on your site — the exact snippet is shown on <a href="/dashboard">the sites page</a>.</p>`;

  const body = html`${header}
${content}
<p>${renderLogoutForm()}</p>`;

  return renderLayout({
    title: `${site} — Tadoru`,
    body,
    version: options.version,
    ...(options.repositoryUrl !== undefined ? { repositoryUrl: options.repositoryUrl } : {}),
  });
}

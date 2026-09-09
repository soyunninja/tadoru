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
import type { Locale } from '../../i18n/Locale.ts';
import { DEFAULT_LOCALE } from '../../i18n/Locale.ts';
import { messagesFor } from '../../i18n/messages.ts';

export type RangeKey = '7d' | '30d' | '12m' | 'today';

const RANGE_ORDER: readonly RangeKey[] = ['today', '7d', '30d', '12m'];

export interface OverviewPageBreakdowns {
  readonly path: readonly MetricRow[];
  readonly referrer: readonly MetricRow[];
  readonly country: readonly MetricRow[];
  readonly device: readonly MetricRow[];
  readonly browser: readonly MetricRow[];
  readonly os: readonly MetricRow[];
  readonly campaign: readonly MetricRow[];
  readonly screen: readonly MetricRow[];
  readonly language: readonly MetricRow[];
  readonly colorScheme: readonly MetricRow[];
}

export interface OverviewPageOptions {
  readonly site: string;
  readonly range: RangeKey;
  readonly totals: HeadlineTotals;
  readonly dailyVisitors: readonly DailyVisitors[];
  readonly breakdowns: OverviewPageBreakdowns;
  readonly version: string;
  readonly repositoryUrl?: string;
  readonly locale?: Locale;
}

function rangeSelector(site: string, current: RangeKey, locale: Locale): SafeHtml {
  const rangeLabels = messagesFor(locale).overview.rangeLabels;
  const links = RANGE_ORDER.map((key) => {
    const label = rangeLabels[key];
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
    breakdowns.campaign.length === 0 &&
    breakdowns.screen.length === 0 &&
    breakdowns.language.length === 0 &&
    breakdowns.colorScheme.length === 0;
  return !(totalsAreZero && breakdownsAreEmpty);
}

export function renderOverviewPage(options: OverviewPageOptions): SafeHtml {
  const locale = options.locale ?? DEFAULT_LOCALE;
  const messages = messagesFor(locale);
  const { site, breakdowns } = options;

  const header = html`<p><a href="/dashboard">&larr; ${messages.common.allSites}</a></p>
<h1>${site}</h1>
${rangeSelector(site, options.range, locale)}`;

  const content = hasAnyData(options)
    ? html`${renderHeadline(options.totals, locale)}
${renderVisitorChart(options.dailyVisitors, locale)}
${renderBreakdownTable(messages.breakdown.titles.campaign, 'campaign', breakdowns.campaign, locale)}
${renderBreakdownTable(messages.breakdown.titles.path, 'path', breakdowns.path, locale)}
${renderBreakdownTable(messages.breakdown.titles.referrer, 'referrer', breakdowns.referrer, locale)}
${renderBreakdownTable(messages.breakdown.titles.country, 'country', breakdowns.country, locale)}
${renderBreakdownTable(messages.breakdown.titles.device, 'device', breakdowns.device, locale)}
${renderBreakdownTable(messages.breakdown.titles.browser, 'browser', breakdowns.browser, locale)}
${renderBreakdownTable(messages.breakdown.titles.os, 'os', breakdowns.os, locale)}
${renderBreakdownTable(messages.breakdown.titles.screen, 'screen', breakdowns.screen, locale)}
${renderBreakdownTable(messages.breakdown.titles.language, 'language', breakdowns.language, locale)}
${renderBreakdownTable(messages.breakdown.titles.colorScheme, 'colorScheme', breakdowns.colorScheme, locale)}`
    : html`<p>${messages.overview.noData} <a href="/dashboard">${messages.overview.noDataLinkText}</a>.</p>
<p class="muted">${messages.overview.ingestDelay}</p>`;

  const body = html`${header}
${content}
<p>${renderLogoutForm(locale)}</p>`;

  return renderLayout({
    title: messages.overview.pageTitle(site),
    body,
    version: options.version,
    locale,
    ...(options.repositoryUrl !== undefined ? { repositoryUrl: options.repositoryUrl } : {}),
  });
}

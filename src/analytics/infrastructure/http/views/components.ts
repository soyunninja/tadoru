import { html } from './escapeHtml.ts';
import type { SafeHtml } from './escapeHtml.ts';
import type { MetricRow } from '../../../domain/report/Metrics.ts';
import type { BreakdownDimension } from '../../../domain/report/Breakdown.ts';
import { countryFlagEmoji, countryDisplayName } from './country.ts';
import { operatingSystemIcon } from './operatingSystem.ts';
import { browserIcon } from './browser.ts';
import { deviceIcon } from './device.ts';
import type { Locale } from '../../i18n/Locale.ts';
import { DEFAULT_LOCALE } from '../../i18n/Locale.ts';
import { messagesFor } from '../../i18n/messages.ts';
import { formatNumber, formatPercent, formatIsoDate, formatDuration } from '../../i18n/format.ts';

/**
 * Additive headline numbers for a range. Unlike `MetricRow.visitors`, these
 * are safe to compute by summing rows of a SINGLE breakdown query — see
 * dashboardRoutes.ts for why the 'device' breakdown specifically is the one
 * used to build this (every visitor has exactly one device/browser/os/
 * country value per day, so summing across those rows never inflates the
 * count — unlike path/referrer/campaign, where one visitor can appear in
 * several rows).
 */
export interface HeadlineTotals {
  readonly pageviews: number;
  readonly visitors: number;
  readonly sessions: number;
  readonly bounces: number;
  readonly engagementSeconds: number;
}

export function sumMetricRows(rows: readonly MetricRow[]): HeadlineTotals {
  let pageviews = 0;
  let visitors = 0;
  let sessions = 0;
  let bounces = 0;
  let engagementSeconds = 0;
  for (const row of rows) {
    pageviews += row.pageviews;
    visitors += row.visitors;
    sessions += row.sessions;
    bounces += row.bounces;
    engagementSeconds += row.engagementSeconds;
  }
  return { pageviews, visitors, sessions, bounces, engagementSeconds };
}

export function bounceRate(totals: HeadlineTotals): number {
  return totals.sessions === 0 ? 0 : totals.bounces / totals.sessions;
}

export function averageEngagementSeconds(totals: HeadlineTotals): number {
  return totals.sessions === 0 ? 0 : totals.engagementSeconds / totals.sessions;
}

/** Readable label for a breakdown row's key, replacing an empty value (e.g. no referrer) with something legible instead of a blank cell. */
export function labelForKey(dimension: BreakdownDimension, key: string, locale: Locale = DEFAULT_LOCALE): string {
  return key.trim().length === 0 ? messagesFor(locale).breakdown.emptyKeyLabels[dimension] : key;
}

/**
 * Which dimensions carry a visual marker, and where it comes from. A dimension
 * absent from this table renders as plain text, which is the right default:
 * a wrong or invented icon is worse than none.
 */
const MARKERS: Partial<Record<BreakdownDimension, (key: string) => string>> = {
  os: operatingSystemIcon,
  browser: browserIcon,
  device: deviceIcon,
};

/**
 * The contents of a breakdown row's first cell.
 *
 * Four dimensions carry a small visual marker: a country gets its flag and its
 * full (locale-translated) name instead of a bare ISO code, while the operating
 * system, browser and device each get an icon from the MARKERS table above.
 * The marker is always `aria-hidden`, because the
 * readable label sits right beside it and a screen reader announcing "flag
 * of Spain Spain" is noise. Anything with no marker to show renders as plain
 * text rather than an empty element.
 */
export function renderKeyCell(dimension: BreakdownDimension, key: string, locale: Locale = DEFAULT_LOCALE): SafeHtml {
  if (dimension === 'country') {
    return html`<span class="marker" aria-hidden="true">${countryFlagEmoji(key)}</span>${countryDisplayName(key, locale)}`;
  }

  const label = labelForKey(dimension, key, locale);
  const marker = MARKERS[dimension];
  if (marker === undefined) return html`${label}`;

  // The slot is rendered even when there is no icon for this row. Glyphs have
  // different advance widths, and an unrecognised value has none at all, so
  // without a fixed-width slot the labels in one table would not line up.
  return html`<span class="marker" aria-hidden="true">${marker(key)}</span>${label}`;
}

/**
 * Which number leads a breakdown table, and therefore what it is sorted by.
 *
 * Pageviews are additive across every dimension — each pageview belongs to
 * exactly one page, one country, one device — whereas unique visitors are not:
 * one person reading two pages appears in two rows. "Top pages" is a question
 * about views, and its title says so, so leading with pageviews both matches
 * the heading and makes the leading column one that actually sums to the total
 * above it.
 *
 * Everywhere else the interesting question is how many people, so visitors
 * lead and the collapsed caveat explains why they will not add up.
 */
const PRIMARY_METRIC: Partial<Record<BreakdownDimension, 'visitors' | 'pageviews'>> = {
  path: 'pageviews',
};

/**
 * Nerd Font icons, from the Font Awesome range (U+F000-U+F2FF).
 *
 * They render as single characters in the bundled subset rather than as inline
 * SVG, which is what makes the interface match the terminal typography. The
 * font ships with the product (assets/fonts/), so these appear for every
 * operator, not only on machines that happen to have it installed — without
 * that, a Private Use Area codepoint would fall back to an empty box.
 *
 * There is no list to keep in step: scripts/build-font.ts imports the exported
 * glyph list below, so an icon added here reaches the bundled font on the next
 * `npm run build:font`.
 *
 * These glyphs are CC BY 4.0; see assets/fonts/NOTICE.md for the attribution.
 */
const ICONS: Readonly<Record<string, string>> = {
  visitors: '\u{f0c0}', // users
  pageviews: '\u{f06e}', // eye
  sessions: '\u{f24d}', // clone
  bounce: '\u{f08b}', // sign-out
  engagement: '\u{f017}', // clock
};

/** Exported so scripts/build-font.ts derives the subset from the code. */
export const HEADLINE_ICON_GLYPHS: readonly string[] = Object.values(ICONS);


function metricTile(icon: string, value: string, unit: string, label: string): SafeHtml {
  const glyph = ICONS[icon] ?? '';
  const unitMarkup = unit === '' ? html`` : html`<span class="unit">${unit}</span>`;
  return html`<div class="metric">
    <span class="icon" aria-hidden="true">${glyph}</span>
    <div><span class="value">${value}</span>${unitMarkup}<div class="label">${label}</div></div>
  </div>`;
}

export function renderHeadline(totals: HeadlineTotals, locale: Locale = DEFAULT_LOCALE): SafeHtml {
  const messages = messagesFor(locale);
  const rate = formatPercent(bounceRate(totals), locale);
  const avgEngagement = formatDuration(averageEngagementSeconds(totals));

  return html`<div class="headline">
${metricTile('visitors', formatNumber(totals.visitors, locale), '', messages.headline.visitors)}
${metricTile('pageviews', formatNumber(totals.pageviews, locale), '', messages.headline.pageviews)}
${metricTile('sessions', formatNumber(totals.sessions, locale), '', messages.headline.sessions)}
${metricTile('bounce', rate.replace('%', ''), '%', messages.headline.bounceRate)}
${metricTile('engagement', avgEngagement, '', messages.headline.avgEngagement)}
</div>
<details class="caveat">
  <summary>${messages.headline.caveatSummary}</summary>
  <p class="muted">${messages.headline.caveatBody}</p>
</details>`;
}

export function renderBreakdownTable(
  title: string,
  dimension: BreakdownDimension,
  rows: readonly MetricRow[],
  locale: Locale = DEFAULT_LOCALE,
): SafeHtml {
  const messages = messagesFor(locale);

  if (rows.length === 0) {
    return html`<section class="card">
  <h2>${title}</h2>
  <p class="muted">${messages.breakdown.noDataForRange}</p>
</section>`;
  }

  const primary = PRIMARY_METRIC[dimension] ?? 'visitors';
  const secondary = primary === 'visitors' ? 'pageviews' : 'visitors';

  const sorted = [...rows].sort((a, b) => b[primary] - a[primary]);
  // The share bar is drawn relative to the busiest row, so the top row always
  // fills the track and the rest read as a proportion of it.
  const busiest = Math.max(...sorted.map((row) => row[primary]), 1);
  const columnLabel = {
    visitors: messages.breakdown.visitorsColumn,
    pageviews: messages.breakdown.pageviewsColumn,
  };

  const bodyRows = sorted.map((row) => {
    const share = Math.round((row[primary] / busiest) * 100);
    return html`<tr><td class="key"><span class="bar" style="width:${share}%" aria-hidden="true"></span><span class="key-label">${renderKeyCell(dimension, row.key, locale)}</span></td><td class="num">${formatNumber(row[primary], locale)}</td><td class="num num-last">${formatNumber(row[secondary], locale)}</td></tr>`;
  });

  return html`<section class="card">
  <h2>${title}</h2>
  <div class="table-scroll">
    <table>
      <thead><tr><th><span class="sr-only">${messages.breakdown.titles[dimension]}</span></th><th class="num">${columnLabel[primary]}</th><th class="num num-last">${columnLabel[secondary]}</th></tr></thead>
      <tbody>${bodyRows}</tbody>
    </table>
  </div>
</section>`;
}

export interface DailyVisitors {
  readonly date: string;
  readonly visitors: number;
}

const CHART_WIDTH = 640;
const CHART_HEIGHT = 160;
const CHART_PADDING = 20;

/**
 * A hand-built inline SVG bar chart, one bar per day. Carries a real
 * accessible text alternative: `role="img"` plus an SVG `<title>` describing
 * the chart, and a visible `<table>` (behind a native, JS-free
 * `<details>` disclosure) listing every date/visitor pair.
 *
 * Every date stays machine-readable: the SVG `<title>` keeps the raw ISO
 * string, and the table cell carries it in a `<time datetime>` attribute.
 * Only the *visible* text — the tile's label — is localised, per
 * `Intl.DateTimeFormat`.
 */
export function renderVisitorChart(days: readonly DailyVisitors[], locale: Locale = DEFAULT_LOCALE): SafeHtml {
  const messages = messagesFor(locale);

  if (days.length === 0) {
    return html`<p class="muted">${messages.chart.noData}</p>`;
  }

  const maxVisitors = Math.max(1, ...days.map((d) => d.visitors));
  const plotWidth = CHART_WIDTH - CHART_PADDING * 2;
  const plotHeight = CHART_HEIGHT - CHART_PADDING * 2;
  const barWidth = plotWidth / days.length;

  const bars = days.map((day, index) => {
    const barHeight = (day.visitors / maxVisitors) * plotHeight;
    const x = CHART_PADDING + index * barWidth;
    const y = CHART_HEIGHT - CHART_PADDING - barHeight;
    const width = Math.max(1, barWidth - 2);
    const barTitle = messages.chart.barTitle(day.date, formatNumber(day.visitors, locale));
    return html`<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${width.toFixed(1)}" height="${barHeight.toFixed(1)}" fill="currentColor"><title>${barTitle}</title></rect>`;
  });

  const tableRows = days.map(
    (day) =>
      html`<tr><td><time datetime="${day.date}">${formatIsoDate(day.date, locale)}</time></td><td>${formatNumber(day.visitors, locale)}</td></tr>`,
  );

  return html`<figure>
  <svg viewBox="0 0 ${CHART_WIDTH} ${CHART_HEIGHT}" width="100%" height="${CHART_HEIGHT}" role="img" aria-label="${messages.chart.ariaLabel}">
    <title>${messages.chart.ariaLabel}</title>
    ${bars}
  </svg>
  <figcaption>
    <details>
      <summary>${messages.chart.tableSummary}</summary>
      <div class="table-scroll">
        <table>
          <thead><tr><th>${messages.chart.dateColumn}</th><th>${messages.chart.visitorsColumn}</th></tr></thead>
          <tbody>${tableRows}</tbody>
        </table>
      </div>
    </details>
  </figcaption>
</figure>`;
}

/** Plain `<form method="post">` submit button — logout must be a POST, never a bare link, since the CSP forbids any JavaScript-driven side effect. */
export function renderLogoutForm(locale: Locale = DEFAULT_LOCALE): SafeHtml {
  return html`<form method="post" action="/logout" class="inline"><button type="submit">${messagesFor(locale).common.logOut}</button></form>`;
}

/**
 * Ready-to-copy install snippet for a measured site: the deferred script tag
 * plus the no-JS pixel fallback (README "Install" / "Visitors without
 * JavaScript"). Identical for every site — site identity comes from the
 * `Origin`/`Referer` header at collection time, not from the snippet. Not
 * locale-dependent: it is source code, not prose.
 */
export function renderTrackingSnippet(host: string, secure: boolean): SafeHtml {
  const scheme = secure ? 'https' : 'http';
  return html`<pre><code>&lt;script defer src="${scheme}://${host}/t.js"&gt;&lt;/script&gt;
&lt;noscript&gt;&lt;img src="${scheme}://${host}/t.gif" alt="" width="1" height="1"&gt;&lt;/noscript&gt;</code></pre>`;
}

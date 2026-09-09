import { html } from './escapeHtml.ts';
import type { SafeHtml } from './escapeHtml.ts';
import type { MetricRow } from '../../../domain/report/Metrics.ts';
import type { BreakdownDimension } from '../../../domain/report/Breakdown.ts';
import { countryFlagEmoji, countryDisplayName } from './country.ts';
import { operatingSystemIcon } from './operatingSystem.ts';

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

/** Formats a duration in seconds as `m:ss`. */
export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(total / 60);
  const remainingSeconds = total % 60;
  return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
}

export function formatPercent(fraction: number): string {
  return `${(fraction * 100).toFixed(1)}%`;
}

const EMPTY_KEY_LABELS: Readonly<Record<BreakdownDimension, string>> = {
  path: '(none)',
  referrer: 'Direct',
  country: '(unknown)',
  device: '(unknown)',
  browser: '(unknown)',
  os: '(unknown)',
  campaign: '(none)',
};

/** Readable label for a breakdown row's key, replacing an empty value (e.g. no referrer) with something legible instead of a blank cell. */
export function labelForKey(dimension: BreakdownDimension, key: string): string {
  return key.trim().length === 0 ? EMPTY_KEY_LABELS[dimension] : key;
}

/**
 * The contents of a breakdown row's first cell.
 *
 * Two dimensions carry a small visual marker: a country gets its flag and its
 * full name instead of a bare ISO code, and an operating system gets an icon.
 * The marker is always `aria-hidden`, because the readable label sits right
 * beside it and a screen reader announcing "flag of Spain Spain" is noise.
 * Anything with no marker to show renders as plain text rather than an empty
 * element.
 */
export function renderKeyCell(dimension: BreakdownDimension, key: string): SafeHtml {
  if (dimension === 'country') {
    const flag = countryFlagEmoji(key);
    const name = countryDisplayName(key);
    return flag === '' ? html`${name}` : html`<span aria-hidden="true">${flag}</span> ${name}`;
  }

  const label = labelForKey(dimension, key);
  if (dimension === 'os') {
    const icon = operatingSystemIcon(key);
    if (icon !== '') return html`<span aria-hidden="true">${icon}</span> ${label}`;
  }
  return html`${label}`;
}

export function renderHeadline(totals: HeadlineTotals): SafeHtml {
  const rate = formatPercent(bounceRate(totals));
  const avgEngagement = formatDuration(averageEngagementSeconds(totals));

  return html`<div class="headline">
  <div class="metric"><div class="value">${totals.visitors}</div><div class="label">Visitors</div></div>
  <div class="metric"><div class="value">${totals.pageviews}</div><div class="label">Pageviews</div></div>
  <div class="metric"><div class="value">${totals.sessions}</div><div class="label">Sessions</div></div>
  <div class="metric"><div class="value">${rate}</div><div class="label">Bounce rate</div></div>
  <div class="metric"><div class="value">${avgEngagement}</div><div class="label">Avg. engagement</div></div>
</div>
<p class="muted">Unique visitors do not add up across the tables below. The same visitor viewing
two pages counts as one visitor above, but as one row under each of those two pages below — so
summing a table's Visitors column won't match the total above, and that's correct, not a bug.</p>`;
}

export function renderBreakdownTable(title: string, dimension: BreakdownDimension, rows: readonly MetricRow[]): SafeHtml {
  if (rows.length === 0) {
    return html`<section>
  <h2>${title}</h2>
  <p class="muted">No data for this range.</p>
</section>`;
  }

  const sorted = [...rows].sort((a, b) => b.visitors - a.visitors);
  const bodyRows = sorted.map(
    (row) =>
      html`<tr><td>${renderKeyCell(dimension, row.key)}</td><td>${row.visitors}</td><td>${row.pageviews}</td></tr>`,
  );

  return html`<section>
  <h2>${title}</h2>
  <div class="table-scroll">
    <table>
      <thead><tr><th>${dimension}</th><th>Visitors</th><th>Pageviews</th></tr></thead>
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
 */
export function renderVisitorChart(days: readonly DailyVisitors[]): SafeHtml {
  if (days.length === 0) {
    return html`<p class="muted">No data to chart.</p>`;
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
    return html`<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${width.toFixed(1)}" height="${barHeight.toFixed(1)}" fill="currentColor"><title>${day.date}: ${day.visitors} visitors</title></rect>`;
  });

  const tableRows = days.map((day) => html`<tr><td>${day.date}</td><td>${day.visitors}</td></tr>`);

  return html`<figure>
  <svg viewBox="0 0 ${CHART_WIDTH} ${CHART_HEIGHT}" width="100%" height="${CHART_HEIGHT}" role="img" aria-label="Visitors per day">
    <title>Visitors per day</title>
    ${bars}
  </svg>
  <figcaption>
    <details>
      <summary>Visitors per day (table)</summary>
      <div class="table-scroll">
        <table>
          <thead><tr><th>Date</th><th>Visitors</th></tr></thead>
          <tbody>${tableRows}</tbody>
        </table>
      </div>
    </details>
  </figcaption>
</figure>`;
}

/** Plain `<form method="post">` submit button — logout must be a POST, never a bare link, since the CSP forbids any JavaScript-driven side effect. */
export function renderLogoutForm(): SafeHtml {
  return html`<form method="post" action="/logout" class="inline"><button type="submit">Log out</button></form>`;
}

/**
 * Ready-to-copy install snippet for a measured site: the deferred script tag
 * plus the no-JS pixel fallback (README "Install" / "Visitors without
 * JavaScript"). Identical for every site — site identity comes from the
 * `Origin`/`Referer` header at collection time, not from the snippet.
 */
export function renderTrackingSnippet(host: string, secure: boolean): SafeHtml {
  const scheme = secure ? 'https' : 'http';
  return html`<pre><code>&lt;script defer src="${scheme}://${host}/t.js"&gt;&lt;/script&gt;
&lt;noscript&gt;&lt;img src="${scheme}://${host}/t.gif" alt="" width="1" height="1"&gt;&lt;/noscript&gt;</code></pre>`;
}

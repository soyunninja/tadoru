import { html, raw } from './escapeHtml.ts';
import { BUNDLED_FONT_URL } from '../../assets.ts';
import type { SafeHtml } from './escapeHtml.ts';
import type { Locale } from '../../i18n/Locale.ts';
import { DEFAULT_LOCALE } from '../../i18n/Locale.ts';
import { messagesFor } from '../../i18n/messages.ts';

/**
 * Last-resort "corresponding source" link for the AGPL-3.0 network clause
 * (see AGENTS.md invariant 10 and docs/adr/0006-agpl-and-the-network-clause.md).
 *
 * Not the normal path: `readPackageMetadata()` in dashboardRoutes.ts sources the
 * real link from package.json's `homepage`, falling back to `repository.url`.
 * This constant is only reached when neither can be read, which in practice
 * means a broken install.
 */
export const DEFAULT_REPOSITORY_URL = 'https://github.com/soyunninja/tadoru';

export interface LayoutOptions {
  readonly title: string;
  readonly body: SafeHtml;
  /**
   * The exact running version, read by the caller from package.json's
   * `version` field at render time (never hardcoded here), so the AGPL
   * network-clause footer can never drift from what is actually deployed.
   */
  readonly version: string;
  readonly repositoryUrl?: string;
  /** Defaults to English. Drives `<html lang>` and the footer copy. */
  readonly locale?: Locale;
}

// Dense, dark, numbers-reading styling. No JS at all: the CSP forbids scripts
// entirely, so every state here is plain CSS.
const STYLE = `
  /* Self-hosted, never from a font CDN: the dashboard makes no third-party
     requests (AGENTS.md invariant 9). A ~31 KB subset carrying Latin text and
     the interface's icon glyphs, so every operator sees the same typography and
     the same icons rather than only those who happen to have the font
     installed. swap keeps text visible while it loads. */
  @font-face {
    font-family: "Tadoru Mono";
    src: url("${BUNDLED_FONT_URL}") format("woff2");
    font-weight: 100 800;
    font-style: normal;
    font-display: swap;
  }
  :root {
    /* Two stacks on purpose. Monospace earns its place on figures and tables,
       where digits and columns must line up; prose reads better in the
       system's own text face.
       "Tadoru Mono" is the bundled subset declared above; it is fetched from
       this origin, which is why the policy in dashboardRoutes.ts carries
       font-src 'self'. The names after it are the locally installed font, used
       when one is present: "JetBrainsMono NF" is the family macOS registers for
       the Nerd-patched build, "JetBrainsMono Nerd Font" what fontconfig
       registers on Linux for the same cask. */
    /* Neither stack ships a CJK face — the bundled subset declared above covers
       Latin text and icons only, and a Japanese subset would be megabytes — so
       both stacks append the same system CJK fallbacks. A browser picks a
       fallback per character it can't find earlier in the stack, so Latin
       text is unaffected and Japanese text still renders instead of tofu
       boxes, at the cost of not being properly monospaced in --font-mono. */
    --font-mono: "Tadoru Mono", "JetBrainsMono NF", "JetBrainsMono Nerd Font",
      "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Consolas,
      "Hiragino Sans", "Noto Sans JP", "Yu Gothic", Meiryo, monospace;
    --font-prose: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
      "Hiragino Sans", "Noto Sans JP", "Yu Gothic", Meiryo, sans-serif;
    /* Dark only, deliberately. Not "dark by default": there is no light
       palette to fall back to, so the interface looks the same on every
       machine regardless of the operating system's setting.
       Declaring color-scheme as dark also tells the browser to render native
       form controls and scrollbars dark, which a background colour cannot. */
    color-scheme: dark;

    /* Dark, because this is a dense data surface read for long stretches.
       Surfaces step upward from the page: a card must sit above its background,
       never below it, or the depth reads inverted.
       Muted label colours stay above 4.5:1 against the card surface — a
       reference screenshot can afford illegible grey, an actual tool cannot.
       layout.test.ts computes those ratios, so this is enforced, not asserted. */
    --bg: #24272d;
    --surface: #2b2f36;
    --surface-2: #33373f;
    --fg: #e9eaec;
    --muted: #949aa4;
    --border: #3a3f47;
    --track: #33373f;
    --accent: #f0883e;
    --ok: #3fb950;
    --warn: #d98a2b;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 1.25rem;
    background: var(--bg);
    color: var(--fg);
    font-family: var(--font-prose);
    font-size: 14px;
    line-height: 1.5;
    -webkit-font-smoothing: antialiased;
  }
  main { max-width: 72rem; margin: 0 auto; }

  /* The app name. The Japanese reading is set as an inverted badge, and carries
     its own lang="ja": without it the browser tries to compose the kana with a
     Latin face, since the bundled subset has no CJK glyphs. */
  .brand {
    max-width: 72rem;
    margin: 0 auto 1rem;
    font-size: 0.95rem;
    font-weight: 600;
    letter-spacing: -0.01em;
  }
  .brand a {
    color: var(--fg);
    text-decoration: none;
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
  }
  .brand-jp {
    background: #ffffff;
    color: #000000;
    border-radius: 4px;
    padding: 0.05rem 0.4rem;
    font-weight: 500;
  }
  a { color: var(--accent); }
  h1 { font-size: 1.25rem; margin: 0 0 0.25rem; letter-spacing: -0.01em; }

  /* --- cards ------------------------------------------------------------- */
  .card {
    background: var(--surface);
    border-radius: 10px;
    padding: 1rem 1.1rem;
    margin: 0 0 1rem;
  }
  .card h2 {
    font-size: 0.9rem;
    font-weight: 600;
    margin: 0;
    letter-spacing: 0.01em;
  }
  .card-sub { color: var(--muted); font-size: 0.78rem; margin: 0.15rem 0 0.9rem; }

  /* --- KPI tiles --------------------------------------------------------- */
  .headline {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr));
    gap: 0.75rem;
    margin: 0 0 1rem;
  }
  .headline .metric {
    display: flex;
    /* Top-aligned, not centred: the icon lines up with the figure rather than
       floating between the figure and its label. The icon box is 2rem, which
       matches the value's line box (1.35rem at line-height 1.5), so the glyph
       and the first digit share a baseline band. */
    align-items: flex-start;
    gap: 0.7rem;
    background: var(--surface);
    border-radius: 10px;
    padding: 0.8rem 0.9rem;
  }
  .headline .icon {
    flex: none;
    width: 2rem;
    height: 2rem;
    display: grid;
    place-items: center;
    color: var(--muted);
  }
  /* The glyph lives in the bundled font's Private Use Area, so this span must
     use the mono face: any fallback renders it as an empty box. */
  .headline .icon { font-family: var(--font-mono); font-size: 15px; line-height: 1; }
  .headline .value {
    font-size: 1.35rem;
    font-weight: 600;
    letter-spacing: -0.02em;
    font-variant-numeric: tabular-nums;
  }
  .headline .unit { font-size: 0.65rem; color: var(--muted); margin-left: 0.15rem; vertical-align: super; }
  .headline .label { color: var(--muted); font-size: 0.75rem; }

  /* --- tables ------------------------------------------------------------ */
  table { border-collapse: collapse; width: 100%; min-width: 26rem; }
  th, td { text-align: left; padding: 0.42rem 0.6rem; border-bottom: 1px solid var(--border); }
  tbody tr:last-child td { border-bottom: 0; }
  thead th {
    color: var(--muted);
    font-size: 0.7rem;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  /* Counts read as a column, not as ragged text: right-aligned, and tabular
     figures so a 7 and a 1234 line up on their units digit. */
  th.num, td.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  /* A fixed last column pins the right edge, so the first figure sits next to
     the second instead of drifting with the width of the label column. Named
     for its position, not its metric: which metric lands there depends on the
     dimension. */
  th.num-last, td.num-last { width: 150px; }

  /* The share bar sits behind the label rather than in a column of its own, so
     the proportion is readable without widening the table. */
  td.key { position: relative; }
  td.key .bar {
    position: absolute;
    left: 0; top: 3px; bottom: 3px;
    background: color-mix(in srgb, var(--accent) 18%, transparent);
    border-left: 2px solid var(--accent);
    border-radius: 2px;
    z-index: 0;
  }
  td.key .key-label { position: relative; z-index: 1; }
  /* A fixed slot for the row marker. Glyph advance widths differ, and rows with
     no icon have none at all, so reserving the space is what keeps the labels
     of one table on a single left edge. */
  .marker {
    display: inline-block;
    width: 25px;
    text-align: left;
    font-family: var(--font-mono);
  }

  /* The data surfaces: tables, headline figures, the snippet, and the chart's
     own labels. Everything else stays in the prose face. */
  table, .headline .value, code, pre, svg text { font-family: var(--font-mono); }

  /* Visually gone, still announced. The section heading already names the
     column on screen, but a data table with an unlabelled column reads badly
     to a screen reader, so the label stays in the accessibility tree. */
  .sr-only {
    position: absolute;
    width: 1px; height: 1px;
    padding: 0; margin: -1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
    border: 0;
  }
  .table-scroll { overflow-x: auto; }
  .muted { color: var(--muted); font-size: 0.82rem; }
  /* Native disclosure, no JavaScript. The explanation is one click from the
     doubt that prompts it, instead of three permanent lines above the data. */
  .caveat { margin: 0 0 1rem; }
  .caveat summary {
    cursor: pointer;
    color: var(--muted);
    font-size: 0.82rem;
    width: fit-content;
  }
  .caveat p { margin: 0.4rem 0 0; max-width: 46rem; }
  nav.muted { margin: 0 0 1rem; }

  input, button {
    font: inherit;
    padding: 0.5rem 0.7rem;
    border: 1px solid var(--border);
    border-radius: 7px;
    background: var(--surface-2);
    color: var(--fg);
  }
  button { cursor: pointer; }
  button:hover { border-color: var(--accent); }
  form.inline { display: inline; }
  code, pre { background: var(--surface-2); border: 1px solid var(--border); border-radius: 7px; }
  code { padding: 0.1rem 0.3rem; }
  pre { padding: 0.75rem; overflow-x: auto; }
  footer {
    max-width: 72rem;
    margin: 1.5rem auto 0;
    padding-top: 1rem;
    border-top: 1px solid var(--border);
    color: var(--muted);
    font-size: 0.78rem;
  }
`;

/**
 * Shared HTML shell used by every dashboard page: the login page, the site
 * list and every overview page. Carries the fixed inline stylesheet, the
 * viewport meta tag and the AGPL network-clause footer (a link to the
 * project's corresponding source and the exact running version) required by
 * AGENTS.md invariant 10.
 */
export function renderLayout(options: LayoutOptions): SafeHtml {
  const repositoryUrl = options.repositoryUrl ?? DEFAULT_REPOSITORY_URL;
  const locale = options.locale ?? DEFAULT_LOCALE;
  const messages = messagesFor(locale);

  return html`<!doctype html>
<html lang="${locale}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Crect width='16' height='16' rx='3' fill='%230a0b0d'/%3E%3Crect x='3' y='9' width='2' height='4' fill='%23f0883e'/%3E%3Crect x='7' y='6' width='2' height='7' fill='%23f0883e'/%3E%3Crect x='11' y='3' width='2' height='10' fill='%23f0883e'/%3E%3C/svg%3E">
<title>${options.title}</title>
<style>${raw(STYLE)}</style>
</head>
<body>
<header class="brand"><a href="/dashboard">tadoru<span class="brand-jp" lang="ja">たどる</span></a></header>
<main>${options.body}</main>
<footer>
<p>${messages.footer.prefix} <a href="${repositoryUrl}">${messages.footer.linkText}</a> ${messages.footer.version(options.version)}.</p>
</footer>
</body>
</html>`;
}

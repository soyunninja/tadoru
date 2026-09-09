import { html, raw } from './escapeHtml.ts';
import type { SafeHtml } from './escapeHtml.ts';

/**
 * Placeholder "corresponding source" link for the AGPL-3.0 network clause
 * (see AGENTS.md invariant 9 and docs/adr/0006-agpl-and-the-network-clause.md).
 * package.json currently has no `repository`/`homepage` field to source this
 * from — once one is added, read it from there instead of hardcoding it.
 */
export const DEFAULT_REPOSITORY_URL = 'https://github.com/tadoru/tadoru';

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
}

// Restrained, numbers-reading-tool styling. No JS: the CSP forbids scripts
// entirely, so dark/light mode is handled purely via prefers-color-scheme.
const STYLE = `
  :root {
    color-scheme: light dark;
    --bg: #ffffff;
    --fg: #1a1a1a;
    --muted: #5f5f5f;
    --border: #dcdcdc;
    --accent: #2b6cb0;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #16181d;
      --fg: #e8e8e8;
      --muted: #9a9a9a;
      --border: #33363c;
      --accent: #6ea8fe;
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 1rem;
    background: var(--bg);
    color: var(--fg);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    line-height: 1.5;
  }
  main { max-width: 60rem; margin: 0 auto; }
  a { color: var(--accent); }
  table { border-collapse: collapse; width: 100%; min-width: 28rem; }
  th, td { text-align: left; padding: 0.4rem 0.6rem; border-bottom: 1px solid var(--border); }
  .table-scroll { overflow-x: auto; margin: 1rem 0; }
  .muted { color: var(--muted); font-size: 0.9rem; }
  .headline { display: flex; flex-wrap: wrap; gap: 1.5rem; margin: 1rem 0; }
  .headline .metric { min-width: 8rem; }
  .headline .metric .value { font-size: 1.6rem; font-weight: 600; }
  .headline .metric .label { color: var(--muted); font-size: 0.85rem; }
  input, button {
    font: inherit;
    padding: 0.5rem 0.7rem;
    border: 1px solid var(--border);
    border-radius: 0.3rem;
    background: var(--bg);
    color: var(--fg);
  }
  button { cursor: pointer; }
  form.inline { display: inline; }
  code, pre { background: rgba(127,127,127,0.12); border-radius: 0.3rem; }
  pre { padding: 0.75rem; overflow-x: auto; }
  footer {
    max-width: 60rem;
    margin: 2rem auto 0;
    padding-top: 1rem;
    border-top: 1px solid var(--border);
    color: var(--muted);
    font-size: 0.85rem;
  }
`;

/**
 * Shared HTML shell used by every dashboard page: the login page, the site
 * list and every overview page. Carries the fixed inline stylesheet, the
 * viewport meta tag and the AGPL network-clause footer (a link to the
 * project's corresponding source and the exact running version) required by
 * AGENTS.md invariant 9.
 */
export function renderLayout(options: LayoutOptions): SafeHtml {
  const repositoryUrl = options.repositoryUrl ?? DEFAULT_REPOSITORY_URL;

  return html`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${options.title}</title>
<style>${raw(STYLE)}</style>
</head>
<body>
<main>${options.body}</main>
<footer>
<p>Tadoru is free software: <a href="${repositoryUrl}">view the corresponding source</a> (version ${options.version}).</p>
</footer>
</body>
</html>`;
}

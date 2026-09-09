import { html } from './escapeHtml.ts';
import type { SafeHtml } from './escapeHtml.ts';
import { renderLayout } from './layout.ts';

export interface LoginPageOptions {
  /**
   * A single generic failure message, shown regardless of the underlying
   * cause (wrong password, rate limit exhausted, ...) so the response never
   * reveals which one happened.
   */
  readonly error?: string;
  readonly version: string;
  readonly repositoryUrl?: string;
}

export function renderLoginPage(options: LoginPageOptions): SafeHtml {
  const errorBlock = options.error === undefined ? html`` : html`<p class="error">${options.error}</p>`;

  const body = html`<h1>Tadoru admin</h1>
${errorBlock}
<form method="post" action="/login">
  <p>
    <label for="password">Password</label><br>
    <input type="password" name="password" id="password" autocomplete="current-password" required>
  </p>
  <p><button type="submit">Log in</button></p>
</form>`;

  return renderLayout({
    title: 'Log in — Tadoru',
    body,
    version: options.version,
    ...(options.repositoryUrl !== undefined ? { repositoryUrl: options.repositoryUrl } : {}),
  });
}

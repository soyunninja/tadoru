import { html } from './escapeHtml.ts';
import type { SafeHtml } from './escapeHtml.ts';
import { renderLayout } from './layout.ts';
import type { Locale } from '../../i18n/Locale.ts';
import { DEFAULT_LOCALE } from '../../i18n/Locale.ts';
import { messagesFor } from '../../i18n/messages.ts';

export interface LoginPageOptions {
  /**
   * A single generic failure message, shown regardless of the underlying
   * cause (wrong password, rate limit exhausted, ...) so the response never
   * reveals which one happened. Callers should source this from
   * `messagesFor(locale).login.genericError` so it stays in the requested
   * language.
   */
  readonly error?: string;
  readonly version: string;
  readonly repositoryUrl?: string;
  readonly locale?: Locale;
}

export function renderLoginPage(options: LoginPageOptions): SafeHtml {
  const locale = options.locale ?? DEFAULT_LOCALE;
  const messages = messagesFor(locale);
  const errorBlock = options.error === undefined ? html`` : html`<p class="error">${options.error}</p>`;

  const body = html`<h1>${messages.login.heading}</h1>
${errorBlock}
<form method="post" action="/login">
  <p>
    <label for="password">${messages.login.passwordLabel}</label><br>
    <input type="password" name="password" id="password" autocomplete="current-password" required>
  </p>
  <p><button type="submit">${messages.login.submit}</button></p>
</form>`;

  return renderLayout({
    title: messages.login.pageTitle,
    body,
    version: options.version,
    locale,
    ...(options.repositoryUrl !== undefined ? { repositoryUrl: options.repositoryUrl } : {}),
  });
}

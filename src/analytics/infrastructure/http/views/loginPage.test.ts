import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderLoginPage } from './loginPage.ts';

test('renderLoginPage renders a password form posting to /login', () => {
  const page = renderLoginPage({ version: '0.1.0' }).toString();
  assert.match(page, /<form method="post" action="\/login"/);
  assert.match(page, /<input[^>]*type="password"[^>]*name="password"/);
  assert.match(page, /<button type="submit">/);
});

test('renderLoginPage shows no error message by default', () => {
  const page = renderLoginPage({ version: '0.1.0' }).toString();
  assert.ok(!page.includes('class="error"'));
});

test('renderLoginPage shows a generic failure message when an error is passed, without saying why', () => {
  const page = renderLoginPage({ version: '0.1.0', error: 'Invalid password or too many attempts.' }).toString();
  assert.match(page, /Invalid password or too many attempts\./);
});

test('renderLoginPage includes no script tags and includes the AGPL footer via the shared layout', () => {
  const page = renderLoginPage({ version: '1.2.3' }).toString();
  assert.ok(!page.includes('<script'));
  assert.match(page, /1\.2\.3/);
  assert.match(page, /<footer>/);
});

test('renderLoginPage translates its heading, label and submit button', () => {
  const spanish = renderLoginPage({ version: '0.1.0', locale: 'es' }).toString();
  assert.match(spanish, /<h1>Administración de Tadoru<\/h1>/);
  assert.match(spanish, /<label for="password">Contraseña<\/label>/);
  assert.match(spanish, /<button type="submit">Iniciar sesión<\/button>/);
  assert.match(spanish, /<html lang="es">/);
});

test('renderLoginPage uses the translated page title', () => {
  const japanese = renderLoginPage({ version: '0.1.0', locale: 'ja' }).toString();
  assert.match(japanese, /<title>ログイン — Tadoru<\/title>/);
});

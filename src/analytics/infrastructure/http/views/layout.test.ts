import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderLayout, DEFAULT_REPOSITORY_URL } from './layout.ts';
import { html } from './escapeHtml.ts';

test('renderLayout produces a full HTML document with the given title and body', () => {
  const page = renderLayout({ title: 'Dashboard', body: html`<p>hello</p>`, version: '0.1.0' }).toString();
  assert.match(page, /^<!doctype html>/i);
  assert.match(page, /<title>Dashboard<\/title>/);
  assert.match(page, /<p>hello<\/p>/);
  assert.match(page, /<\/html>\s*$/);
});

test('renderLayout escapes the title', () => {
  const page = renderLayout({ title: '<script>alert(1)</script>', body: html``, version: '0.1.0' }).toString();
  assert.ok(!page.includes('<script>alert(1)</script>'));
  assert.match(page, /&lt;script&gt;/);
});

test('renderLayout includes a responsive viewport meta tag', () => {
  const page = renderLayout({ title: 'x', body: html``, version: '0.1.0' }).toString();
  assert.match(page, /<meta name="viewport" content="width=device-width, initial-scale=1">/);
});

test('renderLayout includes an inline style block honouring prefers-color-scheme, and no script tags', () => {
  const page = renderLayout({ title: 'x', body: html``, version: '0.1.0' }).toString();
  assert.match(page, /<style>/);
  assert.match(page, /prefers-color-scheme:\s*dark/);
  assert.ok(!page.includes('<script'));
});

test('renderLayout footer links to the project repository and shows the exact running version (AGPL network clause)', () => {
  const page = renderLayout({ title: 'x', body: html``, version: '1.2.3' }).toString();
  assert.match(page, new RegExp(`<a href="${DEFAULT_REPOSITORY_URL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*>`));
  assert.match(page, /1\.2\.3/);
});

test('renderLayout accepts a repositoryUrl override', () => {
  const page = renderLayout({
    title: 'x',
    body: html``,
    version: '1.2.3',
    repositoryUrl: 'https://example.com/repo',
  }).toString();
  assert.match(page, /https:\/\/example\.com\/repo/);
});

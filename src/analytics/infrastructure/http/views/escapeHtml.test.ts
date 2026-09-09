import { test } from 'node:test';
import assert from 'node:assert/strict';
import { escapeHtml, html, raw, SafeHtml } from './escapeHtml.ts';

test('escapeHtml escapes & first, then <, >, ", \'', () => {
  assert.equal(escapeHtml('&'), '&amp;');
  assert.equal(escapeHtml('<'), '&lt;');
  assert.equal(escapeHtml('>'), '&gt;');
  assert.equal(escapeHtml('"'), '&quot;');
  assert.equal(escapeHtml("'"), '&#39;');
});

test('escapeHtml does not double-escape ampersands produced by escaping other characters', () => {
  // If '&' were escaped after '<' etc., "<" would first become "&lt;" and the
  // "&" from that would be escaped again into "&amp;lt;". Escaping "&" first
  // avoids that.
  assert.equal(escapeHtml('<'), '&lt;');
});

test('escapeHtml leaves ordinary text untouched', () => {
  assert.equal(escapeHtml('hello world 123'), 'hello world 123');
});

test('html tag escapes interpolated string values', () => {
  const name = '<b>bold</b>';
  const result = html`<p>${name}</p>`;
  assert.equal(result.toString(), '<p>&lt;b&gt;bold&lt;/b&gt;</p>');
});

test('html tag stringifies and escapes non-string interpolations', () => {
  const count = 5;
  const result = html`<span>${count}</span>`;
  assert.equal(result.toString(), '<span>5</span>');
});

test('html tag flattens and escapes arrays of interpolated values', () => {
  const rows = ['<a>', '<b>'];
  const result = html`<ul>${rows}</ul>`;
  assert.equal(result.toString(), '<ul>&lt;a&gt;&lt;b&gt;</ul>');
});

test('html tag inserts SafeHtml values raw, without re-escaping', () => {
  const inner = html`<b>${'<script>'}</b>`;
  const outer = html`<div>${inner}</div>`;
  assert.equal(outer.toString(), '<div><b>&lt;script&gt;</b></div>');
});

test('raw() produces a SafeHtml instance inserted without escaping', () => {
  const trusted = raw('<hr>');
  const result = html`<div>${trusted}</div>`;
  assert.equal(result.toString(), '<div><hr></div>');
});

test('SafeHtml.toString() returns its raw value', () => {
  const safe = raw('<hr>');
  assert.ok(safe instanceof SafeHtml);
  assert.equal(safe.toString(), '<hr>');
  assert.equal(safe.value, '<hr>');
});

test('the XSS regression: an attacker-controlled value interpolated through html never reaches the output unescaped', () => {
  const attackerControlled = '"><script>alert(1)</script>';
  const result = html`<div data-key="${attackerControlled}">${attackerControlled}</div>`;
  const rendered = result.toString();

  assert.ok(!rendered.includes('<script'), 'rendered output must not contain a literal <script tag from stored data');
  assert.ok(
    rendered.includes('&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;'),
    'rendered output must contain the fully-escaped form of the attacker string',
  );
});

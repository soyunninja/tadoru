import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { COPY_BUTTON_SCRIPT_SOURCE, COPY_BUTTON_SCRIPT_SHA256, renderCopyButtonScript } from './copyScript.ts';

test('COPY_BUTTON_SCRIPT_SHA256 is derived from COPY_BUTTON_SCRIPT_SOURCE via crypto, never hand-written', () => {
  const expected = createHash('sha256').update(COPY_BUTTON_SCRIPT_SOURCE).digest('base64');
  assert.equal(COPY_BUTTON_SCRIPT_SHA256, expected);
});

test('renderCopyButtonScript renders the exact script source with no whitespace injected between the tags', () => {
  const out = renderCopyButtonScript().toString();
  assert.equal(out, `<script>${COPY_BUTTON_SCRIPT_SOURCE}</script>`);
});

test('the exact rendered script body hashes to the same value carried in COPY_BUTTON_SCRIPT_SHA256', () => {
  // This is the property a CSP script-src hash actually depends on: whatever
  // bytes end up between <script> and </script> in the emitted HTML must hash
  // to the value sent in the header, or the browser refuses to run it.
  const out = renderCopyButtonScript().toString();
  const match = out.match(/^<script>([\s\S]*)<\/script>$/);
  assert.ok(match, 'expected a single <script>...</script> wrapper');
  const body = match?.[1] ?? '';
  const computed = createHash('sha256').update(body).digest('base64');
  assert.equal(computed, COPY_BUTTON_SCRIPT_SHA256);
});

test('the copy-button script is small and has no dangerous escape hatches', () => {
  assert.ok(COPY_BUTTON_SCRIPT_SOURCE.length < 2000, 'the inline script should stay tiny');
  assert.ok(!COPY_BUTTON_SCRIPT_SOURCE.includes('eval('));
  assert.ok(!COPY_BUTTON_SCRIPT_SOURCE.includes('innerHTML'));
  assert.ok(!COPY_BUTTON_SCRIPT_SOURCE.includes('document.write'));
});

test('the copy-button script only reacts to elements carrying the copy-button class', () => {
  assert.match(COPY_BUTTON_SCRIPT_SOURCE, /copy-button/);
  assert.match(COPY_BUTTON_SCRIPT_SOURCE, /data-copy-target/);
  assert.match(COPY_BUTTON_SCRIPT_SOURCE, /data-copied-text/);
});

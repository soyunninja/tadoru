import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SUPPORTED_LOCALES } from './Locale.ts';
import { CATALOGUE, messagesFor } from './messages.ts';
import { BREAKDOWN_DIMENSIONS } from '../../domain/report/Breakdown.ts';

test('the catalogue has an entry for every supported locale', () => {
  for (const locale of SUPPORTED_LOCALES) {
    assert.ok(locale in CATALOGUE, `missing catalogue entry for ${locale}`);
  }
});

test('messagesFor returns the matching locale entry', () => {
  assert.equal(messagesFor('en').login.heading, 'Tadoru admin');
  assert.equal(messagesFor('es').login.heading, 'Administración de Tadoru');
  assert.equal(messagesFor('ja').login.heading, 'Tadoru 管理画面');
});

test('every locale translates every breakdown dimension title and empty-key label', () => {
  for (const locale of SUPPORTED_LOCALES) {
    const messages = messagesFor(locale);
    for (const dimension of BREAKDOWN_DIMENSIONS) {
      assert.ok(messages.breakdown.titles[dimension].length > 0, `${locale}/${dimension} title is empty`);
      assert.ok(
        messages.breakdown.emptyKeyLabels[dimension].length > 0,
        `${locale}/${dimension} empty-key label is empty`,
      );
    }
  }
});

test('every locale translates every range label', () => {
  for (const locale of SUPPORTED_LOCALES) {
    const messages = messagesFor(locale);
    for (const rangeKey of ['today', '7d', '30d', '12m'] as const) {
      assert.ok(messages.overview.rangeLabels[rangeKey].length > 0, `${locale}/${rangeKey} range label is empty`);
    }
  }
});

test('no locale silently reuses the English string for a translatable field', () => {
  // A cheap fuzz check against copy-paste: a handful of representative
  // fields should differ between English and each other locale (dimension
  // titles, being closed enumerations rather than free text, are checked
  // exhaustively above instead).
  const en = messagesFor('en');
  for (const locale of SUPPORTED_LOCALES) {
    if (locale === 'en') continue;
    const messages = messagesFor(locale);
    assert.notEqual(messages.login.heading, en.login.heading, `${locale} login heading matches English`);
    assert.notEqual(messages.headline.caveatSummary, en.headline.caveatSummary, `${locale} caveat summary matches English`);
    assert.notEqual(messages.headline.caveatBody, en.headline.caveatBody, `${locale} caveat body matches English`);
    assert.notEqual(messages.footer.prefix, en.footer.prefix, `${locale} footer prefix matches English`);
    assert.notEqual(
      messages.overview.pageTitle('x'),
      undefined,
      `${locale} overview.pageTitle should still be callable`,
    );
  }
});

test('parameterised messages interpolate their arguments', () => {
  assert.equal(messagesFor('en').overview.pageTitle('example.com'), 'example.com — Tadoru');
  assert.equal(messagesFor('en').footer.version('1.2.3'), '(version 1.2.3)');
  assert.equal(messagesFor('es').footer.version('1.2.3'), '(versión 1.2.3)');
  assert.equal(messagesFor('en').chart.barTitle('2026-01-01', '3'), '2026-01-01: 3 visitors');
});

test('the activity summary gets the plural right in every locale', () => {
  // "1 events total" on the line that exists to reassure a new operator reads
  // as carelessness, so each locale applies its own rule.
  assert.match(messagesFor('en').sites.activitySummary('2 seconds ago', '1', 1), /1 event total/);
  assert.match(messagesFor('en').sites.activitySummary('2 seconds ago', '42', 42), /42 events total/);
  assert.match(messagesFor('es').sites.activitySummary('hace 2 segundos', '1', 1), /1 evento en total/);
  assert.match(messagesFor('es').sites.activitySummary('hace 2 segundos', '42', 42), /42 eventos en total/);
  // Japanese has no grammatical plural; the counter word carries it.
  assert.match(messagesFor('ja').sites.activitySummary('2秒前', '1', 1), /合計 1 件/);
});

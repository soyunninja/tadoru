import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveReferrerSource } from './ReferrerSource.ts';
import { createSiteId } from './SiteId.ts';

function siteId(raw: string) {
  const result = createSiteId(raw);
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error('unreachable');
  return result.value;
}

test('empty referrer resolves to direct', () => {
  assert.equal(resolveReferrerSource({ referrer: '', site: siteId('example.com') }), 'direct');
});

test('absent referrer resolves to direct', () => {
  assert.equal(resolveReferrerSource({ referrer: undefined, site: siteId('example.com') }), 'direct');
});

test('referrer host equal to the site host resolves to internal', () => {
  assert.equal(
    resolveReferrerSource({ referrer: 'https://example.com/other-page', site: siteId('example.com') }),
    'internal',
  );
});

test('referrer host equal to the site host modulo www resolves to internal', () => {
  assert.equal(
    resolveReferrerSource({ referrer: 'https://www.example.com/other-page', site: siteId('example.com') }),
    'internal',
  );
});

test('explicit utm_source wins over the referrer host', () => {
  assert.equal(
    resolveReferrerSource({
      referrer: 'https://google.com/search',
      site: siteId('example.com'),
      utmSource: 'newsletter',
    }),
    'newsletter',
  );
});

test('explicit utm_source wins even with no referrer at all', () => {
  assert.equal(
    resolveReferrerSource({ referrer: undefined, site: siteId('example.com'), utmSource: 'newsletter' }),
    'newsletter',
  );
});

for (const [host, expected] of [
  ['https://www.google.com/search', 'Google'],
  ['https://google.co.uk/search', 'Google'],
  ['https://www.bing.com/search', 'Bing'],
  ['https://duckduckgo.com/', 'DuckDuckGo'],
  ['https://www.ecosia.org/', 'Ecosia'],
  ['https://search.brave.com/', 'Brave'],
  ['https://yandex.ru/', 'Yandex'],
  ['https://x.com/user', 'X'],
  ['https://twitter.com/user', 'X'],
  ['https://t.co/abc', 'X'],
  ['https://www.facebook.com/', 'Facebook'],
  ['https://m.facebook.com/', 'Facebook'],
  ['https://www.linkedin.com/', 'LinkedIn'],
  ['https://lnkd.in/abc', 'LinkedIn'],
  ['https://www.reddit.com/', 'Reddit'],
  ['https://news.ycombinator.com/', 'Hacker News'],
  ['https://github.com/', 'GitHub'],
  ['https://www.youtube.com/', 'YouTube'],
] as const) {
  test(`maps known referrer host ${host} to ${expected}`, () => {
    assert.equal(resolveReferrerSource({ referrer: host, site: siteId('example.com') }), expected);
  });
}

test('unknown referrer host falls back to the host with leading www. stripped', () => {
  assert.equal(
    resolveReferrerSource({ referrer: 'https://www.some-blog.dev/post', site: siteId('example.com') }),
    'some-blog.dev',
  );
});

test('a malformed referrer never throws and falls back to direct', () => {
  assert.doesNotThrow(() => resolveReferrerSource({ referrer: 'not a url at all', site: siteId('example.com') }));
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyMetricRow, mergeMetricRowsByKey } from './Metrics.ts';
import type { MetricRow } from './Metrics.ts';

test('emptyMetricRow yields all-zero counters for the given key', () => {
  const row = emptyMetricRow('example.com');
  assert.deepEqual(row, {
    key: 'example.com',
    pageviews: 0,
    visitors: 0,
    sessions: 0,
    bounces: 0,
    engagementSeconds: 0,
  });
});

test('mergeMetricRowsByKey sums counters for rows sharing the same key', () => {
  const rows: MetricRow[] = [
    { key: '/blog', pageviews: 3, visitors: 2, sessions: 2, bounces: 1, engagementSeconds: 30 },
    { key: '/blog', pageviews: 1, visitors: 1, sessions: 1, bounces: 0, engagementSeconds: 10 },
    { key: '/about', pageviews: 5, visitors: 4, sessions: 4, bounces: 2, engagementSeconds: 20 },
  ];

  const merged = mergeMetricRowsByKey(rows);

  assert.equal(merged.length, 2);
  const blog = merged.find((row) => row.key === '/blog');
  const about = merged.find((row) => row.key === '/about');
  assert.deepEqual(blog, { key: '/blog', pageviews: 4, visitors: 3, sessions: 3, bounces: 1, engagementSeconds: 40 });
  assert.deepEqual(about, { key: '/about', pageviews: 5, visitors: 4, sessions: 4, bounces: 2, engagementSeconds: 20 });
});

test('mergeMetricRowsByKey on an empty list yields an empty list', () => {
  assert.deepEqual(mergeMetricRowsByKey([]), []);
});

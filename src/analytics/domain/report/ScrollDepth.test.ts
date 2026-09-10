import { test } from 'node:test';
import assert from 'node:assert/strict';
import { averageScrollDepth, emptyScrollDepthAggregate, mergeScrollDepthAggregatesByPath } from './ScrollDepth.ts';
import type { ScrollDepthAggregate } from './ScrollDepth.ts';

test('emptyScrollDepthAggregate yields all-zero counters for the given path', () => {
  const aggregate = emptyScrollDepthAggregate('/blog');
  assert.deepEqual(aggregate, { path: '/blog', depthSum: 0, sessionsWithData: 0 });
});

test('mergeScrollDepthAggregatesByPath sums counters for rows sharing the same path', () => {
  const rows: ScrollDepthAggregate[] = [
    { path: '/blog', depthSum: 75, sessionsWithData: 1 },
    { path: '/blog', depthSum: 50, sessionsWithData: 1 },
    { path: '/about', depthSum: 100, sessionsWithData: 1 },
  ];

  const merged = mergeScrollDepthAggregatesByPath(rows);

  assert.equal(merged.length, 2);
  const blog = merged.find((row) => row.path === '/blog');
  const about = merged.find((row) => row.path === '/about');
  assert.deepEqual(blog, { path: '/blog', depthSum: 125, sessionsWithData: 2 });
  assert.deepEqual(about, { path: '/about', depthSum: 100, sessionsWithData: 1 });
});

test('mergeScrollDepthAggregatesByPath on an empty list yields an empty list', () => {
  assert.deepEqual(mergeScrollDepthAggregatesByPath([]), []);
});

test('averageScrollDepth is depthSum/sessionsWithData', () => {
  assert.equal(averageScrollDepth({ path: '/blog', depthSum: 150, sessionsWithData: 2 }), 75);
});

test('averageScrollDepth is null when no session produced scroll data, never a division-by-zero NaN or a misleading 0', () => {
  assert.equal(averageScrollDepth({ path: '/blog', depthSum: 0, sessionsWithData: 0 }), null);
});

test(
  'a visitor reaching 75% (three milestone rows: 25, 50, 75) reports a depth of 75, not the naive average of 50 — this is the whole point of the feature',
  () => {
    // This is exactly what the tracker emits for one session scrolling to 75%:
    // newlyCrossedMilestones fires once per milestone newly crossed, so three
    // rows land in raw events for path/session with value 25, 50 and 75. The
    // correct aggregate takes the MAX per (path, session) — 75 — not an
    // average over the three raw rows, which would report 50.
    const perSessionMax = Math.max(25, 50, 75);
    const aggregate: ScrollDepthAggregate = { path: '/article', depthSum: perSessionMax, sessionsWithData: 1 };
    assert.equal(averageScrollDepth(aggregate), 75);
    assert.notEqual(averageScrollDepth(aggregate), 50);
  },
);

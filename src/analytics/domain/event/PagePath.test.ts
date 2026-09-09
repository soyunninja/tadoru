import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizePagePath } from './PagePath.ts';

test('accepts a bare path unchanged', () => {
  assert.equal(sanitizePagePath('/blog/post'), '/blog/post');
});

test('extracts the pathname and query from a full URL', () => {
  assert.equal(sanitizePagePath('https://example.com/blog/post?utm_source=x'), '/blog/post?utm_source=x');
});

test('drops the fragment entirely', () => {
  assert.equal(sanitizePagePath('/blog/post#section-2'), '/blog/post');
  assert.equal(sanitizePagePath('https://example.com/blog/post?utm_source=x#top'), '/blog/post?utm_source=x');
});

test('keeps only allow-listed query parameters', () => {
  assert.equal(
    sanitizePagePath('/blog/post?utm_source=x&utm_medium=y&utm_campaign=z&utm_content=c&utm_term=t&ref=r&other=drop'),
    '/blog/post?utm_source=x&utm_medium=y&utm_campaign=z&utm_content=c&utm_term=t&ref=r',
  );
});

test('drops a PII-looking query parameter entirely', () => {
  assert.equal(sanitizePagePath('/blog/post?email=a@b.com'), '/blog/post');
});

test('drops the query string entirely when nothing survives the allow-list', () => {
  assert.equal(sanitizePagePath('/search?q=secret'), '/search');
});

test('redacts an email-shaped path segment', () => {
  assert.equal(sanitizePagePath('/users/a@b.com/profile'), '/users/:email/profile');
});

test('redacts a UUID path segment', () => {
  assert.equal(sanitizePagePath('/orders/550e8400-e29b-41d4-a716-446655440000'), '/orders/:uuid');
});

test('redacts a run of 6+ digits as an id', () => {
  assert.equal(sanitizePagePath('/users/123456'), '/users/:id');
  assert.equal(sanitizePagePath('/users/12345'), '/users/12345'); // 5 digits: left alone
});

test('redacts a long hex/base64-ish token', () => {
  assert.equal(sanitizePagePath('/reset/aB3fG7hJ9kL2mN4pQ6rS8tU'), '/reset/:token');
});

test('ensures a leading slash', () => {
  assert.equal(sanitizePagePath('blog/post'), '/blog/post');
});

test('collapses duplicate slashes', () => {
  assert.equal(sanitizePagePath('/blog//post///more'), '/blog/post/more');
});

test('strips the trailing slash except for root', () => {
  assert.equal(sanitizePagePath('/blog/post/'), '/blog/post');
  assert.equal(sanitizePagePath('/'), '/');
  assert.equal(sanitizePagePath(''), '/');
});

test('percent-decodes safely', () => {
  assert.equal(sanitizePagePath('/blog/hello%20world'), '/blog/hello world');
});

test('never throws on malformed percent-encoding, falling back to root', () => {
  assert.doesNotThrow(() => sanitizePagePath('/blog/%E0%A4%A'));
});

test('truncates to 1024 characters', () => {
  const longPath = '/' + 'a'.repeat(2000);
  const result = sanitizePagePath(longPath);
  assert.ok(result.length <= 1024);
});

test('never throws on malformed input, yielding root instead', () => {
  assert.doesNotThrow(() => sanitizePagePath(null as unknown as string));
  assert.doesNotThrow(() => sanitizePagePath(undefined as unknown as string));
  assert.equal(sanitizePagePath(null as unknown as string), '/');
  assert.equal(sanitizePagePath(undefined as unknown as string), '/');
});

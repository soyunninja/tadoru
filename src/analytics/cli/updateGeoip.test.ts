import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runUpdateGeoip } from './updateGeoip.ts';

test('runUpdateGeoip reports success when the update process exits cleanly', async () => {
  const logs: string[] = [];
  const result = await runUpdateGeoip({
    runUpdate: async () => ({ code: 0, stdout: 'done\n', stderr: '' }),
    log: (msg) => logs.push(msg),
  });

  assert.equal(result.ok, true);
  assert.ok(logs.some((line) => /updated/i.test(line)));
});

test('runUpdateGeoip fails with a clear message (not a stack trace) when the update process exits non-zero', async () => {
  const result = await runUpdateGeoip({
    runUpdate: async () => ({ code: 1, stdout: '', stderr: 'getaddrinfo ENOTFOUND geolite.maxmind.com' }),
    log: () => {},
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.error, /network/i);
    assert.match(result.error, /ENOTFOUND/);
    assert.equal(result.error.includes('    at '), false); // no stack trace
  }
});

test('runUpdateGeoip fails with a clear message when the update process itself throws (e.g. spawn failure)', async () => {
  const result = await runUpdateGeoip({
    runUpdate: async () => {
      throw new Error('spawn ENOENT');
    },
    log: () => {},
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.error, /failed to update/i);
    assert.match(result.error, /spawn ENOENT/);
  }
});

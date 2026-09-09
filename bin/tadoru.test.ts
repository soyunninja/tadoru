import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCli } from './tadoru.ts';

test('parseCli with no arguments returns help', () => {
  assert.deepEqual(parseCli([]), { kind: 'help' });
});

test('parseCli --help returns help', () => {
  assert.deepEqual(parseCli(['--help']), { kind: 'help' });
  assert.deepEqual(parseCli(['-h']), { kind: 'help' });
});

test('parseCli --version returns version', () => {
  assert.deepEqual(parseCli(['--version']), { kind: 'version' });
  assert.deepEqual(parseCli(['-v']), { kind: 'version' });
});

test('parseCli "help" as a command returns help', () => {
  assert.deepEqual(parseCli(['help']), { kind: 'help' });
});

test('parseCli "start" returns the start command', () => {
  assert.deepEqual(parseCli(['start']), { kind: 'start' });
});

test('parseCli "start --help" returns help for start', () => {
  assert.deepEqual(parseCli(['start', '--help']), { kind: 'help', command: 'start' });
});

test('parseCli "init" with no flags returns init defaults', () => {
  assert.deepEqual(parseCli(['init']), {
    kind: 'init',
    force: false,
    domains: undefined,
    dataDir: undefined,
    port: undefined,
  });
});

test('parseCli "init --force --domains a.com,b.com --data-dir /srv/x --port 9090"', () => {
  assert.deepEqual(
    parseCli(['init', '--force', '--domains', 'a.com,b.com', '--data-dir', '/srv/x', '--port', '9090']),
    { kind: 'init', force: true, domains: 'a.com,b.com', dataDir: '/srv/x', port: 9090 },
  );
});

test('parseCli "install-service" defaults dryRun to false', () => {
  assert.deepEqual(parseCli(['install-service']), { kind: 'install-service', dryRun: false });
});

test('parseCli "install-service --dry-run"', () => {
  assert.deepEqual(parseCli(['install-service', '--dry-run']), { kind: 'install-service', dryRun: true });
});

test('parseCli "backup" returns the backup command', () => {
  assert.deepEqual(parseCli(['backup']), { kind: 'backup' });
});

test('parseCli "update-geoip" returns the update-geoip command', () => {
  assert.deepEqual(parseCli(['update-geoip']), { kind: 'update-geoip' });
});

test('parseCli with an unknown command returns unknown', () => {
  assert.deepEqual(parseCli(['frobnicate']), { kind: 'unknown', name: 'frobnicate' });
});

test('parseCli with an unrecognized flag on a known command still parses the command (positional wins)', () => {
  const result = parseCli(['start', '--bogus']);
  // parseArgs would throw on an unknown option unless we allow it; we assert
  // the CLI does not crash and instead treats it predictably.
  assert.equal(result.kind, 'start');
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCli } from './tadoru.ts';
import { findPackageRootFrom } from '../src/analytics/infrastructure/packageRoot.ts';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

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

test('parseCli "install-service" defaults dryRun, sites and lang', () => {
  assert.deepEqual(parseCli(['install-service']), {
    kind: 'install-service',
    dryRun: false,
    sites: undefined,
    lang: undefined,
  });
});

test('parseCli "install-service --dry-run"', () => {
  assert.deepEqual(parseCli(['install-service', '--dry-run']), {
    kind: 'install-service',
    dryRun: true,
    sites: undefined,
    lang: undefined,
  });
});

test('parseCli "install-service --sites a.com,b.com --lang es"', () => {
  assert.deepEqual(parseCli(['install-service', '--sites', 'a.com,b.com', '--lang', 'es']), {
    kind: 'install-service',
    dryRun: false,
    sites: 'a.com,b.com',
    lang: 'es',
  });
});

test('parseCli "backup" returns the backup command', () => {
  assert.deepEqual(parseCli(['backup']), { kind: 'backup' });
});

test('parseCli "update-geoip" returns the update-geoip command', () => {
  assert.deepEqual(parseCli(['update-geoip']), { kind: 'update-geoip' });
});

test('parseCli "status" with no flags returns status defaults', () => {
  assert.deepEqual(parseCli(['status']), { kind: 'status', json: false });
});

test('parseCli "status --json"', () => {
  assert.deepEqual(parseCli(['status', '--json']), { kind: 'status', json: true });
});

test('parseCli "status --help" returns help for status', () => {
  assert.deepEqual(parseCli(['status', '--help']), { kind: 'help', command: 'status' });
});

test('parseCli "restore <file>" with no flags returns restore defaults', () => {
  assert.deepEqual(parseCli(['restore', '/var/lib/tadoru/tadoru-backup-x.sqlite']), {
    kind: 'restore',
    backupFilePath: '/var/lib/tadoru/tadoru-backup-x.sqlite',
    dryRun: false,
    force: false,
  });
});

test('parseCli "restore <file> --dry-run --force"', () => {
  assert.deepEqual(parseCli(['restore', 'backup.sqlite', '--dry-run', '--force']), {
    kind: 'restore',
    backupFilePath: 'backup.sqlite',
    dryRun: true,
    force: true,
  });
});

test('parseCli "restore" with no file argument leaves backupFilePath undefined', () => {
  assert.deepEqual(parseCli(['restore']), {
    kind: 'restore',
    backupFilePath: undefined,
    dryRun: false,
    force: false,
  });
});

test('parseCli "restore --help" returns help for restore', () => {
  assert.deepEqual(parseCli(['restore', '--help']), { kind: 'help', command: 'restore' });
});

test('parseCli "reset-password" with no flags defaults dryRun to false', () => {
  assert.deepEqual(parseCli(['reset-password']), { kind: 'reset-password', dryRun: false });
});

test('parseCli "reset-password --dry-run"', () => {
  assert.deepEqual(parseCli(['reset-password', '--dry-run']), { kind: 'reset-password', dryRun: true });
});

test('parseCli "reset-password --help" returns help for reset-password', () => {
  assert.deepEqual(parseCli(['reset-password', '--help']), { kind: 'help', command: 'reset-password' });
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

test('install-service resolves a package root that actually contains the systemd template', () => {
  // The CLI reads deploy/tadoru.service relative to the package root. If the
  // root resolves to the wrong directory the command fails at the point an
  // operator is setting up their server, which is the worst moment for it.
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const packageRoot = findPackageRootFrom(moduleDir);
  assert.notEqual(packageRoot, null);
  assert.ok(existsSync(join(packageRoot as string, 'deploy', 'tadoru.service')));
});

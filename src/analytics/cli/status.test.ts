import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { ok, err } from '../../shared/Result.ts';
import type { LoadedConfig } from '../infrastructure/config/loadConfig.ts';
import type { Config } from '../infrastructure/config/Config.ts';
import { openDatabase } from '../infrastructure/persistence/sqlite/Database.ts';
import { SqliteEventRepository } from '../infrastructure/persistence/sqlite/SqliteEventRepository.ts';
import { createTrackedEvent } from '../domain/event/TrackedEvent.ts';
import { createGeoCountry } from '../domain/event/GeoCountry.ts';
import { createSiteId } from '../domain/event/SiteId.ts';
import type { SiteId } from '../domain/event/SiteId.ts';
import {
  runStatusCommand,
  buildStatusReport,
  asHealthBody,
  asLatestVersionInfo,
  compareVersions,
  fetchLatestPublishedVersion,
  inspectDatabaseReadOnly,
  probeableHost,
  DATABASE_FILE_NAME,
} from './status.ts';
import type { StatusPorts, StatusReport, HealthBody } from './status.ts';

function withTempDir<T>(fn: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'tadoru-status-test-'));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function withTempDirAsync<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), 'tadoru-status-test-'));
  try {
    return await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function siteId(domain: string): SiteId {
  const result = createSiteId(domain);
  if (!result.ok) throw new Error(`invalid test site id: ${domain}`);
  return result.value;
}

function buildConfig(overrides: Partial<Config> = {}): Config {
  return {
    host: '127.0.0.1',
    dataDir: './data',
    sites: [siteId('example.com')],
    trustedProxy: false,
    retention: { rawEventMonths: 25 },
    session: { inactivityMinutes: 30, secret: 'test-secret' },
    admin: { passwordHash: 'hash', passwordSalt: 'salt' },
    ...overrides,
  };
}

function buildPorts(overrides: Partial<StatusPorts> = {}): StatusPorts {
  return {
    loadConfig: () => ok<LoadedConfig, string>({ config: buildConfig(), warnings: [] }),
    resolveVersion: () => '9.9.9',
    inspectDatabase: () =>
      ok({
        byteSize: 1234,
        totalEventCount: 10,
        oldestEventAt: 1_700_000_000,
        newestEventAt: 1_700_001_000,
        sites: [{ domain: 'example.com', eventCount: 10, lastEventAt: 1_700_001_000 }],
      }),
    probeHealth: async () => undefined,
    fetchLatestVersion: async () => undefined,
    now: () => 1_700_002_000_000,
    log: () => {},
    ...overrides,
  };
}

function healthyBody(overrides: Partial<HealthBody['jobs'][string]> = {}): HealthBody {
  return {
    status: 'ok',
    database: { reachable: true },
    jobs: {
      saltRotation: { lastRunAt: 1_700_001_500_000, hasRun: true, lastRunFailed: false, intervalMs: 86_400_000, stale: false, ...overrides },
    },
  };
}

test('server answering and database readable: exit code 0, correct fields, distinguishes healthy and stale jobs', async () => {
  const logs: string[] = [];
  const ports = buildPorts({
    probeHealth: async (_host, port) =>
      port === 3000
        ? {
            status: 'degraded',
            database: { reachable: true },
            jobs: {
              saltRotation: { lastRunAt: 1_700_001_500_000, hasRun: true, lastRunFailed: false, intervalMs: 86_400_000, stale: false },
              retentionPurge: { lastRunAt: 1_000, hasRun: true, lastRunFailed: false, intervalMs: 1000, stale: true },
            },
          }
        : undefined,
    log: (message) => logs.push(message),
  });

  const exitCode = await runStatusCommand({ json: true }, ports);

  assert.equal(exitCode, 0);
  assert.equal(logs.length, 1);
  const report = JSON.parse(logs[0] as string) as StatusReport;
  assert.equal(report.server.answering, true);
  assert.equal(report.server.port, 3000);
  assert.equal(report.database.ok, true);
  assert.ok(Array.isArray(report.jobs));
  const jobs = report.jobs ?? [];
  assert.equal(jobs.find((j) => j.name === 'saltRotation')?.stale, false);
  assert.equal(jobs.find((j) => j.name === 'retentionPurge')?.stale, true);
});

test('no server answering: exit non-zero, jobs reported unavailable, database section still populated', async () => {
  const logs: string[] = [];
  const ports = buildPorts({
    probeHealth: async () => undefined,
    log: (message) => logs.push(message),
  });

  const exitCode = await runStatusCommand({ json: true }, ports);

  assert.equal(exitCode, 1);
  const report = JSON.parse(logs[0] as string) as StatusReport;
  assert.equal(report.server.answering, false);
  assert.equal(report.server.port, undefined);
  assert.equal(report.jobs, undefined);
  // Database was still inspected and reported, independent of the server.
  assert.equal(report.database.ok, true);
  if (report.database.ok) {
    assert.equal(report.database.totalEventCount, 10);
  }
});

test('unreadable database (missing file): exit non-zero, clear message, no crash', async () => {
  await withTempDirAsync(async (dir) => {
    const logs: string[] = [];
    const ports = buildPorts({
      loadConfig: () => ok<LoadedConfig, string>({ config: buildConfig({ dataDir: dir }), warnings: [] }),
      inspectDatabase: (path) => inspectDatabaseReadOnly(path, [siteId('example.com')]),
      probeHealth: async (_host, port) => (port === 3000 ? healthyBody() : undefined),
      log: (message) => logs.push(message),
    });

    const exitCode = await runStatusCommand({ json: true }, ports);

    assert.equal(exitCode, 1);
    const report = JSON.parse(logs[0] as string) as StatusReport;
    assert.equal(report.database.ok, false);
    if (!report.database.ok) {
      assert.match(report.database.error, /cannot open/i);
    }
  });
});

test('unreadable database (file exists but is not a valid SQLite database): exit non-zero, clear message, no crash', async () => {
  await withTempDirAsync(async (dir) => {
    const dbPath = join(dir, DATABASE_FILE_NAME);
    writeFileSync(dbPath, 'this is not a sqlite database');

    const logs: string[] = [];
    const ports = buildPorts({
      loadConfig: () => ok<LoadedConfig, string>({ config: buildConfig({ dataDir: dir }), warnings: [] }),
      inspectDatabase: (path) => inspectDatabaseReadOnly(path, [siteId('example.com')]),
      probeHealth: async () => undefined,
      log: (message) => logs.push(message),
    });

    const exitCode = await runStatusCommand({ json: false }, ports);

    assert.equal(exitCode, 1);
    assert.match(logs[0] as string, /database/i);
  });
});

test('inspectDatabaseReadOnly against a real temp-dir SQLite database reports honest counts and per-site stats', async () => {
  await withTempDirAsync(async (dir) => {
    const dbPath = join(dir, DATABASE_FILE_NAME);
    const db = openDatabase(dbPath);
    const repository = new SqliteEventRepository(db);

    const example = siteId('example.com');
    const other = siteId('other.com');

    await repository.saveBatch([
      createTrackedEvent({
        ts: 1_700_000_000,
        siteId: example,
        visitorId: randomBytes(16),
        sessionId: randomBytes(16),
        type: 'pageview',
        path: '/',
        country: createGeoCountry(null),
        deviceType: 'desktop',
        browserFamily: 'Firefox',
        osFamily: 'Linux',
      }),
      createTrackedEvent({
        ts: 1_700_001_000,
        siteId: example,
        visitorId: randomBytes(16),
        sessionId: randomBytes(16),
        type: 'pageview',
        path: '/about',
        country: createGeoCountry(null),
        deviceType: 'mobile',
        browserFamily: 'Safari',
        osFamily: 'iOS',
      }),
    ]);
    db.close();

    const result = inspectDatabaseReadOnly(dbPath, [example, other]);

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.value.totalEventCount, 2);
    assert.equal(result.value.oldestEventAt, 1_700_000_000);
    assert.equal(result.value.newestEventAt, 1_700_001_000);

    const exampleStats = result.value.sites.find((s) => s.domain === example);
    assert.equal(exampleStats?.eventCount, 2);
    assert.equal(exampleStats?.lastEventAt, 1_700_001_000);

    const otherStats = result.value.sites.find((s) => s.domain === other);
    assert.equal(otherStats?.eventCount, 0);
    assert.equal(otherStats?.lastEventAt, undefined);
    assert.ok(result.value.byteSize > 0);
  });
});

test('inspectDatabaseReadOnly never creates a database file when the path does not exist', () => {
  withTempDir((dir) => {
    const dbPath = join(dir, 'does-not-exist.db');
    const result = inspectDatabaseReadOnly(dbPath, []);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.error, /cannot open/i);
  });
});

test('--json output structure mirrors the text report fields', async () => {
  const logs: string[] = [];
  const ports = buildPorts({
    probeHealth: async (_host, port) => (port === 3000 ? healthyBody() : undefined),
    log: (message) => logs.push(message),
  });

  await runStatusCommand({ json: true }, ports);

  const report = JSON.parse(logs[0] as string) as StatusReport;
  assert.equal(typeof report.version, 'string');
  assert.equal(typeof report.dataDir, 'string');
  assert.equal(typeof report.server.answering, 'boolean');
  assert.equal(typeof report.database.ok, 'boolean');
  assert.ok(Array.isArray(report.sites));
  assert.equal(typeof report.retention.months, 'number');
  assert.equal(typeof report.retention.exceedsExemptionWindow, 'boolean');
  assert.ok(Array.isArray(report.jobs));
});

test('the text report never mentions the admin password hash, salt, or session secret', async () => {
  const logs: string[] = [];
  const ports = buildPorts({
    loadConfig: () =>
      ok<LoadedConfig, string>({
        config: buildConfig({
          admin: { passwordHash: 'super-secret-hash-value', passwordSalt: 'super-secret-salt-value' },
          session: { inactivityMinutes: 30, secret: 'super-secret-session-value' },
        }),
        warnings: [],
      }),
    probeHealth: async (_host, port) => (port === 3000 ? healthyBody() : undefined),
    log: (message) => logs.push(message),
  });

  await runStatusCommand({ json: false }, ports);

  const text = (logs[0] as string).toLowerCase();
  assert.ok(!text.includes('secret-hash'));
  assert.ok(!text.includes('secret-salt'));
  assert.ok(!text.includes('secret-session'));
});

test('retention exceeding the exemption window is called out, but does not affect the exit code', async () => {
  const logs: string[] = [];
  const ports = buildPorts({
    loadConfig: () =>
      ok<LoadedConfig, string>({ config: buildConfig({ retention: { rawEventMonths: 36 } }), warnings: [] }),
    probeHealth: async (_host, port) => (port === 3000 ? healthyBody() : undefined),
    log: (message) => logs.push(message),
  });

  const exitCode = await runStatusCommand({ json: true }, ports);

  assert.equal(exitCode, 0);
  const report = JSON.parse(logs[0] as string) as StatusReport;
  assert.equal(report.retention.exceedsExemptionWindow, true);
});

test('a loadConfig failure is reported and exits non-zero without touching other ports', async () => {
  const logs: string[] = [];
  const ports = buildPorts({
    loadConfig: () => err('Admin password is missing.'),
    inspectDatabase: () => {
      throw new Error('must not be called when config fails to load');
    },
    probeHealth: async () => {
      throw new Error('must not be called when config fails to load');
    },
    log: (message) => logs.push(message),
  });

  const exitCode = await runStatusCommand({ json: false }, ports);

  assert.equal(exitCode, 1);
  assert.deepEqual(logs, ['Admin password is missing.']);
});

test('probeableHost maps 0.0.0.0 (every interface) to loopback, since it is not a valid connect target', () => {
  assert.equal(probeableHost('0.0.0.0'), '127.0.0.1');
});

test('probeableHost leaves an explicit loopback address unchanged', () => {
  assert.equal(probeableHost('127.0.0.1'), '127.0.0.1');
});

test('probeableHost leaves a real configured host unchanged, so status probes exactly what was configured', () => {
  assert.equal(probeableHost('stats.example.com'), 'stats.example.com');
  assert.equal(probeableHost('10.0.0.5'), '10.0.0.5');
});

test('a foreign JSON responder is not mistaken for Tadoru', () => {
  // With no port configured this command probes 3000-3009. Something unrelated
  // answering JSON there is normal, not exotic, and casting it blind turned
  // `tadoru status` into "Cannot convert undefined or null to object" — a stack
  // trace at the one moment someone runs this to find out what is broken.
  assert.equal(asHealthBody({ hello: 'world' }), undefined);
  assert.equal(asHealthBody('a string'), undefined);
  assert.equal(asHealthBody(null), undefined);
  assert.equal(asHealthBody(42), undefined);
});

test('a truncated health body is rejected rather than half-trusted', () => {
  // Right shape at the top, missing the part that gets iterated.
  assert.equal(asHealthBody({ status: 'ok', database: { reachable: true } }), undefined);
  assert.equal(asHealthBody({ status: 'ok', jobs: {} }), undefined);
  assert.equal(asHealthBody({ status: 'ok', database: {}, jobs: {} }), undefined);
});

test('our own health body is accepted', () => {
  const body = { status: 'ok', database: { reachable: true }, jobs: {} };
  assert.deepEqual(asHealthBody(body), body);
});

// ---------------------------------------------------------------------------
// Update check
// ---------------------------------------------------------------------------

test('asLatestVersionInfo rejects foreign or wrong-shaped JSON', () => {
  assert.equal(asLatestVersionInfo({}), undefined);
  assert.equal(asLatestVersionInfo({ version: 42 }), undefined);
  assert.equal(asLatestVersionInfo(null), undefined);
  assert.equal(asLatestVersionInfo('a string'), undefined);
  assert.equal(asLatestVersionInfo(['1.2.3']), undefined);
});

test('asLatestVersionInfo accepts a valid registry body', () => {
  assert.equal(asLatestVersionInfo({ version: '1.2.3' }), '1.2.3');
});

test('compareVersions reports equal versions as up to date', () => {
  assert.equal(compareVersions('1.2.3', '1.2.3'), 'up-to-date');
});

test('compareVersions reports a greater patch, minor or major as an update', () => {
  assert.equal(compareVersions('1.2.3', '1.2.4'), 'update-available');
  assert.equal(compareVersions('1.2.3', '1.3.0'), 'update-available');
  assert.equal(compareVersions('1.2.3', '2.0.0'), 'update-available');
});

test('compareVersions reports a lesser latest version as up to date, not a downgrade', () => {
  assert.equal(compareVersions('1.2.3', '1.2.2'), 'up-to-date');
  assert.equal(compareVersions('2.0.0', '1.9.9'), 'up-to-date');
});

test('compareVersions refuses to guess when either side is not a plain x.y.z version', () => {
  assert.equal(compareVersions('1.2.3-rc.1', '1.2.4'), 'not-comparable');
  assert.equal(compareVersions('1.2.3', '1.2.4-rc.1'), 'not-comparable');
  assert.equal(compareVersions('v1.2.3', '1.2.4'), 'not-comparable');
  assert.equal(compareVersions('1.2', '1.2.4'), 'not-comparable');
  assert.equal(compareVersions('1.2.3.4', '1.2.4'), 'not-comparable');
  assert.equal(compareVersions('abc', '1.2.4'), 'not-comparable');
  assert.equal(compareVersions('', '1.2.4'), 'not-comparable');
});

test('fetchLatestPublishedVersion resolves undefined when the registry is unreachable', async () => {
  const fetchImpl = (() => Promise.reject(new Error('connection refused'))) as typeof fetch;
  const result = await fetchLatestPublishedVersion(fetchImpl, 1500);
  assert.equal(result, undefined);
});

test('fetchLatestPublishedVersion resolves undefined when the request times out', async () => {
  const fetchImpl = ((_url: string, init?: { signal?: AbortSignal }) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
    })) as typeof fetch;
  const result = await fetchLatestPublishedVersion(fetchImpl, 20);
  assert.equal(result, undefined);
});

test('fetchLatestPublishedVersion resolves undefined on a rate-limited or unexpected body', async () => {
  const fetchImpl = (() => Promise.resolve({ json: async () => ({ error: 'Too Many Requests' }) } as Response)) as typeof fetch;
  const result = await fetchLatestPublishedVersion(fetchImpl, 1500);
  assert.equal(result, undefined);
});

test('fetchLatestPublishedVersion resolves undefined on malformed JSON', async () => {
  const fetchImpl = (() =>
    Promise.resolve({
      json: async () => {
        throw new Error('Unexpected token');
      },
    } as unknown as Response)) as typeof fetch;
  const result = await fetchLatestPublishedVersion(fetchImpl, 1500);
  assert.equal(result, undefined);
});

test('fetchLatestPublishedVersion resolves the version string on success', async () => {
  const fetchImpl = (() => Promise.resolve({ json: async () => ({ version: '1.2.3' }) } as Response)) as typeof fetch;
  const result = await fetchLatestPublishedVersion(fetchImpl, 1500);
  assert.equal(result, '1.2.3');
});

test('checkForUpdates: false disables the update check and never calls the port', async () => {
  const ports = buildPorts({
    fetchLatestVersion: () => {
      throw new Error('must not be called when the update check is disabled');
    },
  });
  const loaded = ports.loadConfig();
  if (!loaded.ok) throw new Error('unexpected loadConfig failure');

  const report = await buildStatusReport(loaded.value.config, ports, false);
  assert.deepEqual(report.updateCheck, { status: 'disabled' });
});

test('an unreachable registry is reported as unavailable without breaking the rest of the report', async () => {
  const ports = buildPorts();
  const loaded = ports.loadConfig();
  if (!loaded.ok) throw new Error('unexpected loadConfig failure');
  const report = await buildStatusReport(loaded.value.config, ports, true);

  assert.deepEqual(report.updateCheck, { status: 'unavailable', reason: 'could not reach the npm registry' });
  assert.equal(report.database.ok, true);
  assert.ok(Array.isArray(report.sites));
});

test('the same version as the one running is reported up to date', async () => {
  const ports = buildPorts({ fetchLatestVersion: async () => '9.9.9' });
  const loaded = ports.loadConfig();
  if (!loaded.ok) throw new Error('unexpected loadConfig failure');
  const report = await buildStatusReport(loaded.value.config, ports, true);

  assert.deepEqual(report.updateCheck, { status: 'up-to-date', currentVersion: '9.9.9', latestVersion: '9.9.9' });
});

test('a newer published version is reported as an update available', async () => {
  const ports = buildPorts({ fetchLatestVersion: async () => '10.0.0' });
  const loaded = ports.loadConfig();
  if (!loaded.ok) throw new Error('unexpected loadConfig failure');
  const report = await buildStatusReport(loaded.value.config, ports, true);

  assert.deepEqual(report.updateCheck, { status: 'update-available', currentVersion: '9.9.9', latestVersion: '10.0.0' });
});

test('a non-plain published version is reported as not comparable, never guessed', async () => {
  const ports = buildPorts({ fetchLatestVersion: async () => '10.0.0-rc.1' });
  const loaded = ports.loadConfig();
  if (!loaded.ok) throw new Error('unexpected loadConfig failure');
  const report = await buildStatusReport(loaded.value.config, ports, true);

  assert.deepEqual(report.updateCheck, {
    status: 'not-comparable',
    currentVersion: '9.9.9',
    latestVersion: '10.0.0-rc.1',
  });
});

test('the text report names both versions and the upgrade command when an update is available', async () => {
  const logs: string[] = [];
  const ports = buildPorts({
    fetchLatestVersion: async () => '10.0.0',
    probeHealth: async (_host, port) => (port === 3000 ? healthyBody() : undefined),
    log: (message) => logs.push(message),
  });

  await runStatusCommand({ json: false }, ports);

  const text = logs[0] as string;
  assert.match(text, /A newer version is available: v10\.0\.0 \(running v9\.9\.9\)\./);
  assert.match(text, /sudo npm update -g tadoru && sudo systemctl restart tadoru/);
});

test('the text report includes the reason when the registry is unreachable', async () => {
  const logs: string[] = [];
  const ports = buildPorts({
    probeHealth: async (_host, port) => (port === 3000 ? healthyBody() : undefined),
    log: (message) => logs.push(message),
  });

  await runStatusCommand({ json: false }, ports);

  const text = logs[0] as string;
  assert.match(text, /Update check: could not check \(could not reach the npm registry\)/);
});

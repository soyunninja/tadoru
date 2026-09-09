import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from './loadConfig.ts';
import { verifyPasswordHash } from '../http/adminAuth.ts';

function withTempDir<T>(fn: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'tadoru-config-test-'));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function baseEnv(dataDir: string, overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    TADORU_DATA_DIR: dataDir,
    TADORU_ADMIN_PASSWORD: 'a-genuinely-strong-password',
    TADORU_SITES: 'example.com',
    ...overrides,
  };
}

test('refuses to load when the admin password is missing', () => {
  withTempDir((dataDir) => {
    const result = loadConfig({ env: { TADORU_DATA_DIR: dataDir, TADORU_SITES: 'example.com' } });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.match(result.error, /admin password/i);
      assert.match(result.error, /generate/i);
    }
  });
});

test('refuses to load when the admin password is empty', () => {
  withTempDir((dataDir) => {
    const result = loadConfig({ env: baseEnv(dataDir, { TADORU_ADMIN_PASSWORD: '' }) });
    assert.equal(result.ok, false);
  });
});

for (const example of ['change-me', 'cambiame', 'changeme', 'CHANGE-ME', 'ChangeMe']) {
  test(`refuses a known example admin password: ${example}`, () => {
    withTempDir((dataDir) => {
      const result = loadConfig({ env: baseEnv(dataDir, { TADORU_ADMIN_PASSWORD: example }) });
      assert.equal(result.ok, false);
    });
  });
}

test('loads successfully with a real admin password and defaults everything else', () => {
  withTempDir((dataDir) => {
    const result = loadConfig({ env: baseEnv(dataDir) });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.value.config.port, 8080);
    assert.equal(result.value.config.host, '127.0.0.1');
    assert.equal(result.value.config.trustedProxy, false);
    assert.equal(result.value.config.retention.rawEventMonths, 25);
    assert.equal(result.value.config.session.inactivityMinutes, 30);
    assert.deepEqual(result.value.config.sites, ['example.com']);
  });
});

test('the admin password is stored hashed, never in plaintext', () => {
  withTempDir((dataDir) => {
    const result = loadConfig({ env: baseEnv(dataDir, { TADORU_ADMIN_PASSWORD: 'super-secret-value' }) });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.notEqual(result.value.config.admin.passwordHash, 'super-secret-value');
    assert.equal(
      verifyPasswordHash('super-secret-value', {
        salt: result.value.config.admin.passwordSalt,
        hash: result.value.config.admin.passwordHash,
      }),
      true,
    );
  });
});

test('warns loudly when retention.rawEventMonths exceeds 25', () => {
  withTempDir((dataDir) => {
    const result = loadConfig({ env: baseEnv(dataDir, { TADORU_RETENTION_MONTHS: '30' }) });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.value.config.retention.rawEventMonths, 30);
    assert.equal(result.value.warnings.length, 1);
    assert.match(result.value.warnings[0] ?? '', /consent exemption/i);
  });
});

test('does not warn when retention.rawEventMonths is exactly 25', () => {
  withTempDir((dataDir) => {
    const result = loadConfig({ env: baseEnv(dataDir, { TADORU_RETENTION_MONTHS: '25' }) });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.value.warnings.length, 0);
  });
});

test('environment variables override the config file', () => {
  withTempDir((dataDir) => {
    const configPath = join(dataDir, 'tadoru.config.json');
    writeFileSync(configPath, JSON.stringify({ port: 9000, sites: ['from-file.com'] }));
    const result = loadConfig({
      env: baseEnv(dataDir, { TADORU_PORT: '9999', TADORU_SITES: 'from-env.com' }),
      configFilePath: configPath,
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.value.config.port, 9999);
    assert.deepEqual(result.value.config.sites, ['from-env.com']);
  });
});

test('the config file is used when no environment override is present', () => {
  withTempDir((dataDir) => {
    const configPath = join(dataDir, 'tadoru.config.json');
    writeFileSync(configPath, JSON.stringify({ port: 9000, sites: ['from-file.com'] }));
    const result = loadConfig({
      env: { TADORU_DATA_DIR: dataDir, TADORU_ADMIN_PASSWORD: 'a-genuinely-strong-password' },
      configFilePath: configPath,
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.value.config.port, 9000);
    assert.deepEqual(result.value.config.sites, ['from-file.com']);
  });
});

test('normalises configured sites so www. and scheme variants match the same site', () => {
  withTempDir((dataDir) => {
    const result = loadConfig({ env: baseEnv(dataDir, { TADORU_SITES: 'https://www.example.com,example.com' }) });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.value.config.sites, ['example.com']);
  });
});

test('generates and persists a session secret into the data directory when none is supplied', () => {
  withTempDir((dataDir) => {
    const result = loadConfig({ env: baseEnv(dataDir) });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.ok(result.value.config.session.secret.length > 0);

    const files = existsSync(join(dataDir, 'session-secret'));
    assert.equal(files, true);
  });
});

test('reuses a previously persisted session secret on a subsequent load', () => {
  withTempDir((dataDir) => {
    const first = loadConfig({ env: baseEnv(dataDir) });
    assert.equal(first.ok, true);
    if (!first.ok) return;

    const second = loadConfig({ env: baseEnv(dataDir) });
    assert.equal(second.ok, true);
    if (!second.ok) return;

    assert.equal(first.value.config.session.secret, second.value.config.session.secret);
  });
});

test('an explicit TADORU_SESSION_SECRET is used as-is and not overwritten on disk', () => {
  withTempDir((dataDir) => {
    const result = loadConfig({ env: baseEnv(dataDir, { TADORU_SESSION_SECRET: 'explicit-secret-value' }) });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.value.config.session.secret, 'explicit-secret-value');
    assert.equal(existsSync(join(dataDir, 'session-secret')), false);
  });
});

test('TADORU_SITES is comma-separated', () => {
  withTempDir((dataDir) => {
    const result = loadConfig({ env: baseEnv(dataDir, { TADORU_SITES: 'a.com,b.com, c.com' }) });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.value.config.sites, ['a.com', 'b.com', 'c.com']);
  });
});

test('TADORU_TRUSTED_PROXY enables trustedProxy', () => {
  withTempDir((dataDir) => {
    const result = loadConfig({ env: baseEnv(dataDir, { TADORU_TRUSTED_PROXY: 'true' }) });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.value.config.trustedProxy, true);
  });
});

test('reads TADORU_HOST', () => {
  withTempDir((dataDir) => {
    const result = loadConfig({ env: baseEnv(dataDir, { TADORU_HOST: '127.0.0.1' }) });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.value.config.host, '127.0.0.1');
  });
});

test('TADORU_LANG configures the dashboard language when set to a supported locale', () => {
  withTempDir((dataDir) => {
    const result = loadConfig({ env: baseEnv(dataDir, { TADORU_LANG: 'es' }) });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.value.config.language, 'es');
  });
});

test('TADORU_LANG is omitted from the config when unset, leaving Accept-Language negotiation to the request layer', () => {
  withTempDir((dataDir) => {
    const result = loadConfig({ env: baseEnv(dataDir) });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.value.config.language, undefined);
    assert.equal('language' in result.value.config, false);
  });
});

test('an unsupported TADORU_LANG value is ignored rather than rejected', () => {
  withTempDir((dataDir) => {
    const result = loadConfig({ env: baseEnv(dataDir, { TADORU_LANG: 'klingon' }) });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.value.config.language, undefined);
  });
});

test('defaults to binding on loopback, not on every interface', async () => {
  // The documented deployment puts a reverse proxy in front and the systemd unit
  // grants no capabilities, so the service has no reason to accept connections
  // from outside the machine by default. An operator who forgets to set a host
  // must get the safe behaviour, not an admin dashboard exposed to the internet.
  withTempDir((dataDir) => {
    const result = loadConfig({ env: baseEnv(dataDir) });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.value.config.host, '127.0.0.1');
  });
});

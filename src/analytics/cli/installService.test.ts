import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  renderEnvFileContent,
  renderUnitFile,
  runInstallService,
  stripMemoryDenyWriteExecute,
  writeEnvFileToDisk,
} from './installService.ts';
import { verifyPasswordHash } from '../infrastructure/http/adminAuth.ts';

const SAMPLE_TEMPLATE = `[Unit]
Description=Tadoru

[Service]
Type=simple
User=tadoru
Group=tadoru
StateDirectory=tadoru
Environment=TADORU_DATA_DIR=/var/lib/tadoru
EnvironmentFile=/etc/tadoru/tadoru.env
ExecStart=/usr/bin/env tadoru start
KillSignal=SIGTERM
TimeoutStopSec=30s

# NOTE: do NOT add MemoryDenyWriteExecute=yes here.
[Install]
WantedBy=multi-user.target
`;

const TEMPLATE_WITH_DIRECTIVE = `${SAMPLE_TEMPLATE}MemoryDenyWriteExecute=yes\n`;

test('renderUnitFile substitutes the binary path, user and data directory', () => {
  const rendered = renderUnitFile(SAMPLE_TEMPLATE, {
    execPath: '/usr/local/bin/tadoru',
    user: 'tadoru',
    dataDir: '/var/lib/tadoru',
  });

  assert.match(rendered, /ExecStart=\/usr\/local\/bin\/tadoru start/);
  assert.match(rendered, /User=tadoru/);
  assert.match(rendered, /Group=tadoru/);
  assert.match(rendered, /Environment=TADORU_DATA_DIR=\/var\/lib\/tadoru/);
});

test('renderUnitFile substitutes a custom user everywhere it appears', () => {
  const rendered = renderUnitFile(SAMPLE_TEMPLATE, {
    execPath: '/usr/local/bin/tadoru',
    user: 'custom-user',
    dataDir: '/data',
  });

  assert.match(rendered, /User=custom-user/);
  assert.match(rendered, /Group=custom-user/);
});

test('stripMemoryDenyWriteExecute removes the directive if present', () => {
  const stripped = stripMemoryDenyWriteExecute(TEMPLATE_WITH_DIRECTIVE);
  assert.doesNotMatch(stripped, /^\s*MemoryDenyWriteExecute\s*=\s*yes\s*$/m);
});

test('stripMemoryDenyWriteExecute is a no-op when the directive is absent', () => {
  const stripped = stripMemoryDenyWriteExecute(SAMPLE_TEMPLATE);
  assert.equal(stripped, SAMPLE_TEMPLATE);
});

test('renderUnitFile output never contains MemoryDenyWriteExecute=yes, even if the template does', () => {
  const rendered = renderUnitFile(TEMPLATE_WITH_DIRECTIVE, {
    execPath: '/usr/local/bin/tadoru',
    user: 'tadoru',
    dataDir: '/var/tadoru',
  });
  assert.doesNotMatch(rendered, /^\s*MemoryDenyWriteExecute\s*=\s*yes\s*$/m);
});

test('renderEnvFileContent includes the password hash+salt, sites, host, port, trusted-proxy flag and language', () => {
  const content = renderEnvFileContent({
    passwordHash: 'deadbeef',
    passwordSalt: 'cafef00d',
    sites: ['example.com', 'other.dev'],
    lang: 'en',
  });
  assert.match(content, /^TADORU_ADMIN_PASSWORD_HASH=deadbeef$/m);
  assert.match(content, /^TADORU_ADMIN_PASSWORD_SALT=cafef00d$/m);
  assert.match(content, /^TADORU_SITES=example\.com,other\.dev$/m);
  assert.match(content, /^TADORU_HOST=127\.0\.0\.1$/m);
  assert.match(content, /^TADORU_PORT=3000$/m);
  assert.match(content, /^TADORU_TRUSTED_PROXY=true$/m);
  assert.match(content, /^TADORU_LANG=en$/m);
  assert.doesNotMatch(content, /^TADORU_ADMIN_PASSWORD=/m);
});

function baseOptions(overrides: Partial<Parameters<typeof runInstallService>[0]> = {}) {
  const logs: string[] = [];
  const calls: { readonly port: string; readonly args: readonly unknown[] }[] = [];

  return {
    logs,
    calls,
    options: {
      platform: 'linux',
      isRoot: true,
      dryRun: false,
      execPath: '/usr/local/bin/tadoru',
      dataDir: '/var/lib/tadoru',
      sites: 'example.com',
      readTemplate: () => SAMPLE_TEMPLATE,
      log: (message: string) => logs.push(message),
      randomBytes: (size: number) => new Uint8Array(size).fill(7),
      pathExists: (path: string) => {
        calls.push({ port: 'pathExists', args: [path] });
        return false;
      },
      userExists: (user: string) => {
        calls.push({ port: 'userExists', args: [user] });
        return false;
      },
      createSystemUser: (user: string) => {
        calls.push({ port: 'createSystemUser', args: [user] });
      },
      mkdirEtcTadoru: (path: string) => {
        calls.push({ port: 'mkdirEtcTadoru', args: [path] });
      },
      writeEnvFile: (path: string, content: string) => {
        calls.push({ port: 'writeEnvFile', args: [path, content] });
      },
      writeUnitFile: (path: string, content: string) => {
        calls.push({ port: 'writeUnitFile', args: [path, content] });
      },
      systemctlDaemonReload: () => {
        calls.push({ port: 'systemctlDaemonReload', args: [] });
      },
      ...overrides,
    },
  };
}

test('runInstallService refuses cleanly on a non-Linux platform, even with --dry-run', async () => {
  const { options } = baseOptions({ platform: 'darwin', dryRun: true });
  const result = await runInstallService(options);

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.error, /linux/i);
    assert.match(result.error, /systemd/i);
  }
});

test('runInstallService refuses when not run as root', async () => {
  const { options, calls } = baseOptions({ isRoot: false });
  const result = await runInstallService(options);

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.error, /root/i);
    assert.match(result.error, /sudo/i);
  }
  assert.equal(calls.length, 0);
});

test('runInstallService refuses when no valid site is given', async () => {
  const { options, calls } = baseOptions({ sites: undefined });
  const result = await runInstallService(options);

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.error, /site/i);
  }
  assert.equal(calls.length, 0);
});

test('runInstallService refuses when every candidate site is invalid', async () => {
  const { options, calls } = baseOptions({ sites: '   ,,192.168.0.1' });
  const result = await runInstallService(options);

  assert.equal(result.ok, false);
  assert.equal(calls.length, 0);
});

test('runInstallService refuses on an unsupported --lang', async () => {
  const { options, calls } = baseOptions({ lang: 'xx' });
  const result = await runInstallService(options);

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.error, /lang/i);
  }
  assert.equal(calls.length, 0);
});

test('runInstallService --dry-run on Linux prints the rendered unit and calls no port at all', async () => {
  const { options, logs, calls } = baseOptions({ dryRun: true });
  const result = await runInstallService(options);

  assert.equal(result.ok, true);
  assert.equal(calls.length, 0, 'dry-run must touch nothing');
  const output = logs.join('\n');
  assert.match(output, /ExecStart=\/usr\/local\/bin\/tadoru start/);
  assert.match(output, /tadoru.*system user/i);
  assert.match(output, /\/etc\/systemd\/system\/tadoru\.service/);
  assert.match(output, /\/etc\/tadoru\/tadoru\.env/);
  assert.match(output, /systemctl daemon-reload/i);
  assert.doesNotMatch(output, /^\s*MemoryDenyWriteExecute\s*=\s*yes\s*$/m);
});

test('runInstallService performs every action in order: user, dir, env file, unit, daemon-reload, password', async () => {
  const { options, logs, calls } = baseOptions();
  const result = await runInstallService(options);

  assert.equal(result.ok, true);
  assert.deepEqual(
    calls.map((c) => c.port),
    ['userExists', 'createSystemUser', 'mkdirEtcTadoru', 'pathExists', 'writeEnvFile', 'writeUnitFile', 'systemctlDaemonReload'],
  );

  const output = logs.join('\n');
  const userIndex = output.indexOf('Created system user');
  const dirIndex = output.indexOf('/etc/tadoru exists');
  const envIndex = output.indexOf('Wrote /etc/tadoru/tadoru.env');
  const unitIndex = output.indexOf('Wrote /etc/systemd/system/tadoru.service');
  const reloadIndex = output.indexOf('daemon-reload');
  const passwordIndex = output.indexOf('Generated admin password:');

  assert.ok(userIndex < dirIndex, 'user creation logged before directory creation');
  assert.ok(dirIndex < envIndex, 'directory creation logged before env file');
  assert.ok(envIndex < unitIndex, 'env file logged before unit file');
  assert.ok(unitIndex < reloadIndex, 'unit file logged before daemon-reload');
  assert.ok(reloadIndex < passwordIndex, 'daemon-reload logged before the password');
});

test('runInstallService says the user already exists rather than creating it', async () => {
  const { options, logs, calls } = baseOptions({
    userExists: (user: string) => {
      calls.push({ port: 'userExists', args: [user] });
      return true;
    },
  });
  const result = await runInstallService(options);

  assert.equal(result.ok, true);
  assert.ok(!calls.some((c) => c.port === 'createSystemUser'));
  assert.match(logs.join('\n'), /already exists/i);
});

test('runInstallService never overwrites an existing tadoru.env', async () => {
  const { options, logs, calls } = baseOptions({
    pathExists: (path: string) => {
      calls.push({ port: 'pathExists', args: [path] });
      return true;
    },
  });
  const result = await runInstallService(options);

  assert.equal(result.ok, true);
  assert.ok(!calls.some((c) => c.port === 'writeEnvFile'), 'must not write over an existing env file');
  const output = logs.join('\n');
  assert.match(output, /tadoru\.env already exists/i);
  assert.match(output, /kept/i);
  assert.doesNotMatch(output, /Generated admin password:/);
});

test('runInstallService prints the generated password to stdout but passes it as an argument to no other port', async () => {
  const { options, logs, calls } = baseOptions();
  const result = await runInstallService(options);
  assert.equal(result.ok, true);

  const output = logs.join('\n');
  const passwordMatch = /Generated admin password: (\S+)/.exec(output);
  assert.ok(passwordMatch, 'password must be printed to stdout');
  const password = passwordMatch[1] as string;
  assert.ok(password.length > 0);

  for (const call of calls) {
    if (call.port === 'writeEnvFile') continue; // the password legitimately lives in the env file's content
    for (const arg of call.args) {
      assert.ok(
        typeof arg !== 'string' || !arg.includes(password),
        `password leaked into a ${call.port} argument`,
      );
    }
  }
});

test('runInstallService writes TADORU_ADMIN_PASSWORD_HASH and TADORU_ADMIN_PASSWORD_SALT, and never writes plaintext TADORU_ADMIN_PASSWORD anywhere', async () => {
  const { options, logs, calls } = baseOptions();
  const result = await runInstallService(options);
  assert.equal(result.ok, true);

  const writeCall = calls.find((c) => c.port === 'writeEnvFile');
  assert.ok(writeCall, 'writeEnvFile must be called');
  const content = writeCall.args[1] as string;

  assert.match(content, /^TADORU_ADMIN_PASSWORD_HASH=[0-9a-f]+$/m);
  assert.match(content, /^TADORU_ADMIN_PASSWORD_SALT=[0-9a-f]+$/m);
  assert.doesNotMatch(content, /^TADORU_ADMIN_PASSWORD=/m);

  const output = logs.join('\n');
  const passwordMatch = /Generated admin password: (\S+)/.exec(output);
  assert.ok(passwordMatch, 'the plaintext password is still printed to stdout once');
  const plaintextPassword = passwordMatch[1] as string;

  const hashMatch = /^TADORU_ADMIN_PASSWORD_HASH=([0-9a-f]+)$/m.exec(content);
  const saltMatch = /^TADORU_ADMIN_PASSWORD_SALT=([0-9a-f]+)$/m.exec(content);
  assert.ok(hashMatch && saltMatch);
  assert.equal(
    verifyPasswordHash(plaintextPassword, { hash: hashMatch[1] as string, salt: saltMatch[1] as string }),
    true,
    'the written hash+salt must verify against the printed plaintext password',
  );
  assert.doesNotMatch(content, new RegExp(plaintextPassword.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('writeEnvFileToDisk (the real port implementation) creates the file at mode 0600', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tadoru-install-service-'));
  const envPath = join(dir, 'tadoru.env');
  try {
    writeEnvFileToDisk(envPath, 'TADORU_ADMIN_PASSWORD=x\n');
    const mode = statSync(envPath).mode & 0o777;
    assert.equal(mode, 0o600);
    assert.equal(readFileSync(envPath, 'utf8'), 'TADORU_ADMIN_PASSWORD=x\n');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('runInstallService, wired to the real writeEnvFileToDisk port, writes the env file at mode 0600', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tadoru-install-service-'));
  const envPath = join(dir, 'tadoru.env');
  try {
    const { options } = baseOptions({
      writeEnvFile: (path: string, content: string) => {
        void path; // the real port always targets /etc/tadoru/tadoru.env; redirected to a temp file here
        writeEnvFileToDisk(envPath, content);
      },
    });
    const result = await runInstallService(options);
    assert.equal(result.ok, true);
    const mode = statSync(envPath).mode & 0o777;
    assert.equal(mode, 0o600);
    assert.match(readFileSync(envPath, 'utf8'), /TADORU_ADMIN_PASSWORD_HASH=/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

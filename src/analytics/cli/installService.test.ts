import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderUnitFile, runInstallService, stripMemoryDenyWriteExecute } from './installService.ts';

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
    dataDir: '/var/lib/tadoru',
  });
  assert.doesNotMatch(rendered, /^\s*MemoryDenyWriteExecute\s*=\s*yes\s*$/m);
});

test('runInstallService refuses cleanly on a non-Linux platform, even with --dry-run', async () => {
  const logs: string[] = [];
  const result = await runInstallService({
    platform: 'darwin',
    dryRun: true,
    readTemplate: () => SAMPLE_TEMPLATE,
    execPath: '/usr/local/bin/tadoru',
    dataDir: '/var/lib/tadoru',
    user: 'tadoru',
    log: (msg) => logs.push(msg),
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.error, /linux/i);
    assert.match(result.error, /systemd/i);
  }
});

test('runInstallService --dry-run on Linux prints the rendered unit and writes nothing', async () => {
  const logs: string[] = [];
  const writes: unknown[] = [];

  const result = await runInstallService({
    platform: 'linux',
    dryRun: true,
    readTemplate: () => SAMPLE_TEMPLATE,
    execPath: '/usr/local/bin/tadoru',
    dataDir: '/var/lib/tadoru',
    user: 'tadoru',
    log: (msg) => logs.push(msg),
    writeUnitFile: (path, content) => {
      writes.push({ path, content });
    },
  });

  assert.equal(result.ok, true);
  assert.equal(writes.length, 0);
  const output = logs.join('\n');
  assert.match(output, /ExecStart=\/usr\/local\/bin\/tadoru start/);
  assert.match(output, /would create/i);
  assert.match(output, /tadoru \(system user\)/i);
  assert.match(output, /\/etc\/systemd\/system\/tadoru\.service/);
  assert.match(output, /\/etc\/tadoru\/tadoru\.env/);
  assert.doesNotMatch(output, /^\s*MemoryDenyWriteExecute\s*=\s*yes\s*$/m);
});

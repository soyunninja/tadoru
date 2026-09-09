import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildConfigFileObject,
  generateAdminPassword,
  promptInitAnswers,
  renderEnvFileContent,
  resolveInitAnswers,
  runInit,
} from './init.ts';
import type { PromptPort } from './init.ts';

async function withTempDir<T>(fn: (dir: string) => Promise<T> | T): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), 'tadoru-init-test-'));
  try {
    return await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('resolveInitAnswers uses flags when the terminal is non-interactive', () => {
  const answers = resolveInitAnswers({
    isInteractive: false,
    flags: { domains: 'example.com,other.example', dataDir: '/srv/tadoru', port: 9000 },
  });
  assert.deepEqual(answers, { domains: ['example.com', 'other.example'], dataDir: '/srv/tadoru', port: 9000 });
});

test('resolveInitAnswers falls back to sane defaults non-interactively with no flags', () => {
  const answers = resolveInitAnswers({ isInteractive: false, flags: {} });
  assert.deepEqual(answers, { domains: [], dataDir: './data', port: 8080 });
});

test('generateAdminPassword produces a long, high-entropy string from injected randomness', () => {
  const fakeRandomBytes = (size: number) => Buffer.alloc(size, 7);
  const password = generateAdminPassword(fakeRandomBytes);
  assert.ok(password.length >= 24);
  // Must never emit the literal placeholder value.
  assert.notEqual(password.toLowerCase(), 'change-me');
});

test('renderEnvFileContent embeds the password and nothing else sensitive', () => {
  const content = renderEnvFileContent('s3cr3t-value');
  assert.match(content, /TADORU_ADMIN_PASSWORD=s3cr3t-value/);
});

test('buildConfigFileObject never includes the admin password', () => {
  const config = buildConfigFileObject({ domains: ['example.com'], dataDir: './data', port: 8080 });
  assert.equal(JSON.stringify(config).includes('adminPassword'), false);
  assert.deepEqual(config.sites, ['example.com']);
  assert.equal(config.port, 8080);
  assert.equal(config.dataDir, './data');
});

test('runInit refuses to overwrite an existing config without --force', async () => {
  await withTempDir(async (dir) => {
    const configPath = join(dir, 'tadoru.config.json');
    writeFileSync(configPath, '{}');

    const logs: string[] = [];
    const result = await runInit({
      configPath,
      envPath: join(dir, 'tadoru.env'),
      force: false,
      isInteractive: false,
      flags: {},
      randomBytes: (size) => Buffer.alloc(size, 1),
      log: (msg) => logs.push(msg),
    });

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.match(result.error, /already exists/i);
      assert.match(result.error, /--force/);
    }
  });
});

test('runInit writes config and a 0600 env file, and prints the password exactly once', async () => {
  await withTempDir(async (dir) => {
    const configPath = join(dir, 'tadoru.config.json');
    const envPath = join(dir, 'tadoru.env');
    const logs: string[] = [];

    const result = await runInit({
      configPath,
      envPath,
      force: false,
      isInteractive: false,
      flags: { domains: 'example.com', dataDir: dir, port: 8080 },
      randomBytes: (size) => Buffer.alloc(size, 42),
      log: (msg) => logs.push(msg),
    });

    assert.equal(result.ok, true);
    assert.ok(existsSync(configPath));
    assert.ok(existsSync(envPath));

    const configContent = readFileSync(configPath, 'utf8');
    assert.equal(configContent.includes('adminPassword'), false);
    const parsedConfig = JSON.parse(configContent) as { sites: string[] };
    assert.deepEqual(parsedConfig.sites, ['example.com']);

    const mode = statSync(envPath).mode & 0o777;
    assert.equal(mode, 0o600);

    const envContent = readFileSync(envPath, 'utf8');
    assert.match(envContent, /TADORU_ADMIN_PASSWORD=/);

    const password = extractPassword(envContent);
    // The password must appear in the printed output at least once...
    assert.ok(logs.some((line) => line.includes(password)));
    // ...and the warning that it will not be shown again must be present.
    assert.ok(logs.some((line) => /will not be shown again/i.test(line)));
  });
});

function extractPassword(envContent: string): string {
  const match = /TADORU_ADMIN_PASSWORD=(.+)/.exec(envContent);
  if (match === null || match[1] === undefined) {
    throw new Error('no password found in env content');
  }
  return match[1].trim();
}

test('promptInitAnswers asks for domains, data directory and port, applying defaults on blank answers', async () => {
  const answersQueue = ['a.example, b.example', '', ''];
  const questionsAsked: string[] = [];
  const fakePrompt: PromptPort = {
    question: (query: string) => {
      questionsAsked.push(query);
      const next = answersQueue.shift();
      return Promise.resolve(next ?? '');
    },
  };

  const answers = await promptInitAnswers(fakePrompt);

  assert.deepEqual(answers, { domains: ['a.example', 'b.example'], dataDir: './data', port: 8080 });
  assert.equal(questionsAsked.length, 3);
  assert.match(questionsAsked[0] ?? '', /domain/i);
  assert.match(questionsAsked[1] ?? '', /data directory/i);
  assert.match(questionsAsked[2] ?? '', /port/i);
});

test('runInit prompts interactively when isInteractive is true and a prompt port is given', async () => {
  await withTempDir(async (dir) => {
    const configPath = join(dir, 'tadoru.config.json');
    const envPath = join(dir, 'tadoru.env');
    const answersQueue = ['prompted.example', dir, '9090'];
    const fakePrompt: PromptPort = {
      question: () => Promise.resolve(answersQueue.shift() ?? ''),
    };

    const result = await runInit({
      configPath,
      envPath,
      force: false,
      isInteractive: true,
      prompt: fakePrompt,
      flags: { domains: 'ignored.example' },
      randomBytes: (size) => Buffer.alloc(size, 5),
      log: () => {},
    });

    assert.equal(result.ok, true);
    const parsedConfig = JSON.parse(readFileSync(configPath, 'utf8')) as { sites: string[]; port: number };
    assert.deepEqual(parsedConfig.sites, ['prompted.example']);
    assert.equal(parsedConfig.port, 9090);
  });
});

test('runInit overwrites an existing config when --force is passed', async () => {
  await withTempDir(async (dir) => {
    const configPath = join(dir, 'tadoru.config.json');
    const envPath = join(dir, 'tadoru.env');
    writeFileSync(configPath, '{"old":true}');

    const result = await runInit({
      configPath,
      envPath,
      force: true,
      isInteractive: false,
      flags: { domains: 'new.example', dataDir: dir, port: 8080 },
      randomBytes: (size) => Buffer.alloc(size, 3),
      log: () => {},
    });

    assert.equal(result.ok, true);
    const parsedConfig = JSON.parse(readFileSync(configPath, 'utf8')) as { sites: string[] };
    assert.deepEqual(parsedConfig.sites, ['new.example']);
  });
});

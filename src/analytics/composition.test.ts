import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TadoruServer } from './infrastructure/http/server.ts';
import type { Config } from './infrastructure/config/Config.ts';
import type { LoadedConfig } from './infrastructure/config/loadConfig.ts';
import { ok, err } from '../shared/Result.ts';
import { resolvePackageVersion, startApp, installGracefulShutdown } from './composition.ts';
import type { RunningApp } from './composition.ts';

function withTempDir<T>(fn: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'tadoru-composition-test-'));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function baseConfig(overrides: Partial<Config> = {}): Config {
  return {
    port: 8080,
    host: '127.0.0.1',
    dataDir: './data',
    sites: ['a.example', 'b.example'] as unknown as Config['sites'],
    trustedProxy: false,
    retention: { rawEventMonths: 25 },
    session: { inactivityMinutes: 30, secret: 'top-secret-session-value' },
    admin: { passwordHash: 'super-secret-hash', passwordSalt: 'salt' },
    ...overrides,
  };
}

function fakeTadoruServer(overrides: Partial<{ listenCalls: unknown[]; closeCalls: number }> = {}): {
  server: TadoruServer;
  listenCalls: readonly unknown[];
  closeCallCount: () => number;
} {
  const listenCalls: unknown[] = [];
  let closeCalls = overrides.closeCalls ?? 0;
  const server = {
    fastify: {
      listen: async (opts: unknown) => {
        listenCalls.push(opts);
      },
    },
    scheduler: {},
    close: async () => {
      closeCalls += 1;
    },
  } as unknown as TadoruServer;
  return { server, listenCalls, closeCallCount: () => closeCalls };
}

test('resolvePackageVersion walks up directories until it finds package.json', () => {
  withTempDir((dir) => {
    const nested = join(dir, 'a', 'b', 'c');
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ version: '9.9.9' }));
    const version = resolvePackageVersion(nested, (path) => {
      // Simulate real fs: only the file directly under `dir` exists.
      if (path === join(dir, 'package.json')) {
        return JSON.stringify({ version: '9.9.9' });
      }
      throw new Error('ENOENT');
    });
    assert.equal(version, '9.9.9');
  });
});

test('resolvePackageVersion returns "unknown" when no package.json is found', () => {
  const version = resolvePackageVersion('/nowhere', () => {
    throw new Error('ENOENT');
  });
  assert.equal(version, 'unknown');
});

test('startApp returns an error and never builds the server when config fails to load', async () => {
  let buildServerCalled = false;
  const result = await startApp({
    loadConfig: () => err('admin password is missing'),
    buildServer: () => {
      buildServerCalled = true;
      return fakeTadoruServer().server;
    },
    log: () => {},
    logError: () => {},
    resolveVersion: () => '1.0.0',
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error, 'admin password is missing');
  }
  assert.equal(buildServerCalled, false);
});

test('startApp logs configuration warnings', async () => {
  const config = baseConfig();
  const loaded: LoadedConfig = { config, warnings: ['retention.rawEventMonths is set to 30, beyond the 25-month window'] };
  const logs: string[] = [];
  const { server } = fakeTadoruServer();

  await startApp({
    loadConfig: () => ok(loaded),
    buildServer: () => server,
    log: (msg) => logs.push(msg),
    logError: () => {},
    resolveVersion: () => '1.0.0',
  });

  assert.ok(logs.some((line) => line.includes('30, beyond the 25-month window')));
});

test('startApp builds the server, listens on the configured host/port, and logs a startup summary', async () => {
  const config = baseConfig({ port: 4321, host: '127.0.0.1', dataDir: '/var/lib/tadoru' });
  const loaded: LoadedConfig = { config, warnings: [] };
  const logs: string[] = [];
  const { server, listenCalls } = fakeTadoruServer();
  let receivedOptions: unknown;

  const result = await startApp({
    loadConfig: () => ok(loaded),
    buildServer: (options) => {
      receivedOptions = options;
      return server;
    },
    log: (msg) => logs.push(msg),
    logError: () => {},
    resolveVersion: () => '2.5.0',
  });

  assert.equal(result.ok, true);
  assert.deepEqual(receivedOptions, { config });
  assert.deepEqual(listenCalls, [{ port: 4321, host: '127.0.0.1' }]);

  const summary = logs.join('\n');
  assert.match(summary, /2\.5\.0/);
  assert.match(summary, /4321/);
  assert.match(summary, /\/var\/lib\/tadoru/);
  assert.match(summary, /2/); // two configured sites
});

test('startApp never logs the password hash or the session secret', async () => {
  const config = baseConfig();
  const loaded: LoadedConfig = { config, warnings: [] };
  const logs: string[] = [];
  const { server } = fakeTadoruServer();

  await startApp({
    loadConfig: () => ok(loaded),
    buildServer: () => server,
    log: (msg) => logs.push(msg),
    logError: () => {},
    resolveVersion: () => '1.0.0',
  });

  const summary = logs.join('\n');
  assert.ok(!summary.includes(config.admin.passwordHash));
  assert.ok(!summary.includes(config.session.secret));
});

test('startApp resolves close() to the underlying server close()', async () => {
  const config = baseConfig();
  const loaded: LoadedConfig = { config, warnings: [] };
  const { server, closeCallCount } = fakeTadoruServer();

  const result = await startApp({
    loadConfig: () => ok(loaded),
    buildServer: () => server,
    log: () => {},
    logError: () => {},
    resolveVersion: () => '1.0.0',
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  await result.value.close();
  assert.equal(closeCallCount(), 1);
});

function createFakeProcess(): { on: (event: string, cb: () => void) => void; trigger: (event: string) => void } {
  const handlers = new Map<string, () => void>();
  return {
    on(event, cb) {
      handlers.set(event, cb);
    },
    trigger(event) {
      handlers.get(event)?.();
    },
  };
}

test('installGracefulShutdown awaits close() before exiting, on SIGTERM', async () => {
  const order: string[] = [];
  const app: RunningApp = {
    close: () =>
      new Promise((resolve) => {
        setTimeout(() => {
          order.push('closed');
          resolve();
        }, 10);
      }),
  };
  const exitCodes: number[] = [];
  const fakeProcess = createFakeProcess();

  installGracefulShutdown(app, {
    process: fakeProcess,
    exit: (code) => {
      order.push('exit');
      exitCodes.push(code);
    },
    log: () => {},
  });

  fakeProcess.trigger('SIGTERM');
  await new Promise((resolve) => setTimeout(resolve, 30));

  assert.deepEqual(order, ['closed', 'exit']);
  assert.deepEqual(exitCodes, [0]);
});

test('installGracefulShutdown responds to SIGINT the same way', async () => {
  const order: string[] = [];
  const app: RunningApp = {
    close: () =>
      new Promise((resolve) => {
        order.push('closed');
        resolve();
      }),
  };
  const fakeProcess = createFakeProcess();

  installGracefulShutdown(app, {
    process: fakeProcess,
    exit: () => order.push('exit'),
    log: () => {},
  });

  fakeProcess.trigger('SIGINT');
  await new Promise((resolve) => setTimeout(resolve, 10));

  assert.deepEqual(order, ['closed', 'exit']);
});

test('installGracefulShutdown only closes once even if signalled twice', async () => {
  let closeCallCount = 0;
  const app: RunningApp = {
    close: async () => {
      closeCallCount += 1;
    },
  };
  const fakeProcess = createFakeProcess();

  installGracefulShutdown(app, {
    process: fakeProcess,
    exit: () => {},
    log: () => {},
  });

  fakeProcess.trigger('SIGTERM');
  fakeProcess.trigger('SIGTERM');
  fakeProcess.trigger('SIGINT');
  await new Promise((resolve) => setTimeout(resolve, 10));

  assert.equal(closeCallCount, 1);
});

test('installGracefulShutdown exits with code 1 if close() rejects, without throwing', async () => {
  const app: RunningApp = {
    close: () => Promise.reject(new Error('flush failed')),
  };
  const exitCodes: number[] = [];
  const fakeProcess = createFakeProcess();

  installGracefulShutdown(app, {
    process: fakeProcess,
    exit: (code) => exitCodes.push(code),
    log: () => {},
  });

  fakeProcess.trigger('SIGTERM');
  await new Promise((resolve) => setTimeout(resolve, 10));

  assert.deepEqual(exitCodes, [1]);
});

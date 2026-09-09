import { test } from 'node:test';
import assert from 'node:assert/strict';
import { err, ok } from '../../shared/Result.ts';
import type { RunningApp } from '../composition.ts';
import { runStartCommand } from './start.ts';

test('runStartCommand returns exit code 1 and logs the error when startApp fails', async () => {
  const errors: string[] = [];
  const exitCode = await runStartCommand({
    startApp: async () => err('Admin password is missing.'),
    installGracefulShutdown: () => {
      throw new Error('must not be called when startup failed');
    },
    logError: (message) => errors.push(message),
  });

  assert.equal(exitCode, 1);
  assert.deepEqual(errors, ['Admin password is missing.']);
});

test('runStartCommand installs graceful shutdown and returns exit code 0 when startup succeeds', async () => {
  const app: RunningApp = { close: async () => {} };
  let installedWith: RunningApp | undefined;

  const exitCode = await runStartCommand({
    startApp: async () => ok(app),
    installGracefulShutdown: (runningApp) => {
      installedWith = runningApp;
    },
    logError: () => {
      throw new Error('must not log an error on success');
    },
  });

  assert.equal(exitCode, 0);
  assert.equal(installedWith, app);
});

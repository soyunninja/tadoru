import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Scheduler } from './Scheduler.ts';

interface FakeTimers {
  readonly schedule: (fn: () => void, delayMs: number) => { cancel: () => void };
  tick(ms: number): void;
}

/**
 * A deterministic fake for the scheduler's injected timer port: `tick`
 * advances virtual time and runs any callback whose delay has elapsed,
 * so tests never sleep.
 */
function createFakeTimers(): FakeTimers {
  let now = 0;
  const pending: { dueAt: number; fn: () => void; cancelled: boolean }[] = [];

  return {
    schedule(fn, delayMs) {
      const entry = { dueAt: now + delayMs, fn, cancelled: false };
      pending.push(entry);
      return { cancel: () => { entry.cancelled = true; } };
    },
    tick(ms) {
      now += ms;
      for (const entry of pending) {
        if (!entry.cancelled && entry.dueAt <= now) {
          entry.cancelled = true; // one-shot: the job itself reschedules
          entry.fn();
        }
      }
    },
  };
}

function buildJob(name: string, calls: string[]) {
  return {
    name,
    intervalMs: 1000,
    run: async () => {
      calls.push(name);
    },
  };
}

test('runs each job on its configured interval', async () => {
  const calls: string[] = [];
  const timers = createFakeTimers();
  const scheduler = new Scheduler({ jobs: [buildJob('rotateSalt', calls)], timers });

  scheduler.start();
  timers.tick(1000);
  await Promise.resolve();
  await Promise.resolve();

  assert.deepEqual(calls, ['rotateSalt']);
  scheduler.stop();
});

test('reschedules a job after it runs, so it fires repeatedly', async () => {
  const calls: string[] = [];
  const timers = createFakeTimers();
  const scheduler = new Scheduler({ jobs: [buildJob('rotateSalt', calls)], timers });

  scheduler.start();
  timers.tick(1000);
  await Promise.resolve();
  await Promise.resolve();
  timers.tick(1000);
  await Promise.resolve();
  await Promise.resolve();

  assert.deepEqual(calls, ['rotateSalt', 'rotateSalt']);
  scheduler.stop();
});

test('does not run any job before start()', () => {
  const calls: string[] = [];
  const timers = createFakeTimers();
  const scheduler = new Scheduler({ jobs: [buildJob('rotateSalt', calls)], timers });

  timers.tick(10_000);
  assert.deepEqual(calls, []);
  scheduler.stop();
});

test('stop() prevents further runs, cleanly (as SIGTERM requires)', async () => {
  const calls: string[] = [];
  const timers = createFakeTimers();
  const scheduler = new Scheduler({ jobs: [buildJob('rotateSalt', calls)], timers });

  scheduler.start();
  timers.tick(1000);
  await Promise.resolve();
  await Promise.resolve();
  scheduler.stop();
  timers.tick(10_000);

  assert.deepEqual(calls, ['rotateSalt']);
});

test('stop() is idempotent and safe to call twice', () => {
  const timers = createFakeTimers();
  const scheduler = new Scheduler({ jobs: [buildJob('rotateSalt', [])], timers });
  scheduler.start();
  scheduler.stop();
  assert.doesNotThrow(() => scheduler.stop());
});

test('records the last successful run time of each job for health reporting', async () => {
  let now = 5000;
  const timers = createFakeTimers();
  const scheduler = new Scheduler({
    jobs: [buildJob('rotateSalt', [])],
    timers,
    clock: { now: () => new Date(now) },
  });

  assert.equal(scheduler.getLastRunTimes()['rotateSalt'], undefined);

  scheduler.start();
  timers.tick(1000);
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(scheduler.getLastRunTimes()['rotateSalt'], now);
  scheduler.stop();
});

test('a job that throws does not stop the scheduler or crash the process', async () => {
  const timers = createFakeTimers();
  let attempts = 0;
  const scheduler = new Scheduler({
    jobs: [
      {
        name: 'flaky',
        intervalMs: 1000,
        run: async () => {
          attempts += 1;
          throw new Error('boom');
        },
      },
    ],
    timers,
  });

  scheduler.start();
  timers.tick(1000);
  await Promise.resolve();
  await Promise.resolve();
  timers.tick(1000);
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(attempts, 2);
  scheduler.stop();
});

test('runs multiple jobs independently on their own intervals', async () => {
  const calls: string[] = [];
  const timers = createFakeTimers();
  const scheduler = new Scheduler({
    jobs: [
      { name: 'fast', intervalMs: 100, run: async () => { calls.push('fast'); } },
      { name: 'slow', intervalMs: 1000, run: async () => { calls.push('slow'); } },
    ],
    timers,
  });

  scheduler.start();
  timers.tick(100); // fast's first run; slow not due yet
  await Promise.resolve();
  await Promise.resolve();
  timers.tick(900); // fast's rescheduled run at 200 is now due, as is slow's first run at 1000
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(calls.filter((c) => c === 'fast').length, 2);
  assert.equal(calls.filter((c) => c === 'slow').length, 1);
  scheduler.stop();
});

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
  const now = 5000;
  const timers = createFakeTimers();
  const scheduler = new Scheduler({
    jobs: [buildJob('rotateSalt', [])],
    timers,
    clock: { now: () => new Date(now) },
  });

  assert.equal(scheduler.getJobStatuses().find((s) => s.name === 'rotateSalt')?.lastRunAt, undefined);

  scheduler.start();
  timers.tick(1000);
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(scheduler.getJobStatuses().find((s) => s.name === 'rotateSalt')?.lastRunAt, now);
  scheduler.stop();
});

test('getJobStatuses reports hasRun as true after the first attempt, even a failing one', async () => {
  const timers = createFakeTimers();
  let calls = 0;
  const scheduler = new Scheduler({
    jobs: [
      {
        name: 'flaky',
        intervalMs: 1000,
        run: async () => {
          calls += 1;
          if (calls === 1) throw new Error('boom');
        },
      },
    ],
    timers,
  });

  assert.equal(scheduler.getJobStatuses()[0]?.hasRun, false);

  scheduler.start();
  timers.tick(1000);
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(scheduler.getJobStatuses()[0]?.hasRun, true);
  scheduler.stop();
});

test('getJobStatuses reports lastRunFailed true right after a throwing run, and false again after a subsequent success', async () => {
  const timers = createFakeTimers();
  let calls = 0;
  const scheduler = new Scheduler({
    jobs: [
      {
        name: 'flaky',
        intervalMs: 1000,
        run: async () => {
          calls += 1;
          if (calls === 1) throw new Error('boom');
        },
      },
    ],
    timers,
  });

  scheduler.start();
  timers.tick(1000);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(scheduler.getJobStatuses()[0]?.lastRunFailed, true);

  timers.tick(1000);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(scheduler.getJobStatuses()[0]?.lastRunFailed, false);

  scheduler.stop();
});

test('getJobStatuses leaves lastRunAt untouched by a failing run that follows a prior success', async () => {
  const timers = createFakeTimers();
  let now = 1000;
  let calls = 0;
  const scheduler = new Scheduler({
    jobs: [
      {
        name: 'sometimesFlaky',
        intervalMs: 1000,
        run: async () => {
          calls += 1;
          if (calls === 2) throw new Error('boom');
        },
      },
    ],
    timers,
    clock: { now: () => new Date(now) },
  });

  scheduler.start();
  now = 1000;
  timers.tick(1000); // first run: succeeds at ts 1000
  await Promise.resolve();
  await Promise.resolve();
  const successAt = scheduler.getJobStatuses()[0]?.lastRunAt;
  assert.equal(successAt, 1000);

  now = 2000;
  timers.tick(1000); // second run: throws
  await Promise.resolve();
  await Promise.resolve();

  const status = scheduler.getJobStatuses()[0];
  assert.equal(status?.lastRunAt, successAt);
  assert.equal(status?.lastRunFailed, true);

  scheduler.stop();
});

test('getStartedAt is undefined before start() and set to the clock time once start() runs', () => {
  const timers = createFakeTimers();
  const scheduler = new Scheduler({
    jobs: [buildJob('rotateSalt', [])],
    timers,
    clock: { now: () => new Date(42_000) },
  });

  assert.equal(scheduler.getStartedAt(), undefined);

  scheduler.start();

  assert.equal(scheduler.getStartedAt(), 42_000);
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

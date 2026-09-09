import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bindPort, AUTO_PORT_RANGE_START, AUTO_PORT_RANGE_SIZE } from './bindPort.ts';

function addressInUseError(): NodeJS.ErrnoException {
  const error = new Error('listen EADDRINUSE') as NodeJS.ErrnoException;
  error.code = 'EADDRINUSE';
  return error;
}

/** A fake `listen` that fails for every port in `busyPorts` and succeeds otherwise. */
function fakeListen(busyPorts: readonly number[]): {
  listen: (port: number) => Promise<void>;
  attempts: number[];
} {
  const attempts: number[] = [];
  return {
    attempts,
    listen: async (port: number) => {
      attempts.push(port);
      if (busyPorts.includes(port)) {
        throw addressInUseError();
      }
    },
  };
}

test('an explicit busy port fails rather than moving to another one', async () => {
  const { listen, attempts } = fakeListen([9000]);
  const result = await bindPort({ requestedPort: 9000, listen });

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.error, /9000/);
  assert.match(result.error, /already in use/i);
  assert.deepEqual(attempts, [9000]);
});

test('an explicit free port binds directly', async () => {
  const { listen, attempts } = fakeListen([]);
  const result = await bindPort({ requestedPort: 9000, listen });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.port, 9000);
  assert.equal(result.value.autoSelected, false);
  assert.deepEqual(attempts, [9000]);
});

test('an unset port binds the first candidate when it is free', async () => {
  const { listen, attempts } = fakeListen([]);
  const result = await bindPort({ requestedPort: undefined, listen });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.port, AUTO_PORT_RANGE_START);
  assert.equal(result.value.autoSelected, false);
  assert.deepEqual(attempts, [AUTO_PORT_RANGE_START]);
});

test('an unset port walks to the next free candidate when the first is busy', async () => {
  const { listen, attempts } = fakeListen([AUTO_PORT_RANGE_START]);
  const result = await bindPort({ requestedPort: undefined, listen });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.port, AUTO_PORT_RANGE_START + 1);
  assert.equal(result.value.autoSelected, true);
  assert.deepEqual(attempts, [AUTO_PORT_RANGE_START, AUTO_PORT_RANGE_START + 1]);
});

test('an unset port fails with a useful message when every candidate is busy', async () => {
  const allCandidates = Array.from({ length: AUTO_PORT_RANGE_SIZE }, (_, i) => AUTO_PORT_RANGE_START + i);
  const { listen, attempts } = fakeListen(allCandidates);
  const result = await bindPort({ requestedPort: undefined, listen });

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.error, new RegExp(String(AUTO_PORT_RANGE_START)));
  assert.match(result.error, new RegExp(String(AUTO_PORT_RANGE_START + AUTO_PORT_RANGE_SIZE - 1)));
  assert.match(result.error, /all in use/i);
  assert.deepEqual(attempts, allCandidates);
});

test('a non-EADDRINUSE error from an explicit port propagates unchanged', async () => {
  const permissionError = new Error('listen EACCES') as NodeJS.ErrnoException;
  permissionError.code = 'EACCES';

  await assert.rejects(
    bindPort({
      requestedPort: 80,
      listen: async () => {
        throw permissionError;
      },
    }),
    (error: unknown) => error === permissionError,
  );
});

test('a non-EADDRINUSE error while walking auto candidates propagates unchanged and stops the walk', async () => {
  const invalidAddressError = new Error('listen EINVAL') as NodeJS.ErrnoException;
  invalidAddressError.code = 'EINVAL';
  const attempts: number[] = [];

  await assert.rejects(
    bindPort({
      requestedPort: undefined,
      listen: async (port: number) => {
        attempts.push(port);
        if (port === AUTO_PORT_RANGE_START) throw addressInUseError();
        throw invalidAddressError;
      },
    }),
    (error: unknown) => error === invalidAddressError,
  );

  assert.deepEqual(attempts, [AUTO_PORT_RANGE_START, AUTO_PORT_RANGE_START + 1]);
});

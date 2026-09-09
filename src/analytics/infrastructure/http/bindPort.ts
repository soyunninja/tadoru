import type { Result } from '../../../shared/Result.ts';
import { ok, err } from '../../../shared/Result.ts';

/** First port tried when none was configured. Chosen to match the number every "port already in use" complaint names. */
export const AUTO_PORT_RANGE_START = 3000;
/** How many sequential candidates to try, starting at `AUTO_PORT_RANGE_START`, before giving up. */
export const AUTO_PORT_RANGE_SIZE = 10;

export interface BindPortOptions {
  /** The operator's explicit `TADORU_PORT` / `port` setting. `undefined` means "pick one automatically". */
  readonly requestedPort: number | undefined;
  /** Attempts to bind exactly this port. Rejects with a `NodeJS.ErrnoException` (`code: 'EADDRINUSE'`) when it is taken. */
  readonly listen: (port: number) => Promise<void>;
}

export interface BoundPort {
  readonly port: number;
  /** True only when no port was configured and the first candidate (`AUTO_PORT_RANGE_START`) was busy. */
  readonly autoSelected: boolean;
}

function isAddressInUseError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'EADDRINUSE'
  );
}

/**
 * Binds the configured port, or — when none was configured — the first free
 * port starting at `AUTO_PORT_RANGE_START`.
 *
 * An explicitly configured port never moves: on a server a reverse proxy
 * points at a fixed port, so silently binding a different one after a
 * reboot would leave the proxy pointing nowhere with no error anywhere.
 * Busy therefore fails outright rather than falling back.
 *
 * The check-then-bind race is avoided on purpose: this only ever learns a
 * port is busy from the bind attempt itself (`EADDRINUSE`), never from a
 * separate probe, so nothing can take the port in between.
 *
 * Any other failure (a bad address, a permissions error, ...) propagates
 * unchanged — it is not `EADDRINUSE`, so falling back to another port would
 * hide it instead of fixing anything.
 */
export async function bindPort(options: BindPortOptions): Promise<Result<BoundPort, string>> {
  const { requestedPort, listen } = options;

  if (requestedPort !== undefined) {
    try {
      await listen(requestedPort);
      return ok({ port: requestedPort, autoSelected: false });
    } catch (error) {
      if (!isAddressInUseError(error)) throw error;
      return err(
        `Port ${requestedPort} is already in use. Free it, or set a different port via TADORU_PORT ` +
          '(or "port" in tadoru.config.json).',
      );
    }
  }

  const lastCandidate = AUTO_PORT_RANGE_START + AUTO_PORT_RANGE_SIZE - 1;
  for (let candidate = AUTO_PORT_RANGE_START; candidate <= lastCandidate; candidate++) {
    try {
      await listen(candidate);
      return ok({ port: candidate, autoSelected: candidate !== AUTO_PORT_RANGE_START });
    } catch (error) {
      if (!isAddressInUseError(error)) throw error;
      if (candidate === lastCandidate) {
        return err(
          `Ports ${AUTO_PORT_RANGE_START}-${lastCandidate} are all in use. Free one of them, or set ` +
            'TADORU_PORT to choose a specific port.',
        );
      }
      // Busy and more candidates remain: try the next one.
    }
  }

  // Unreachable: the loop above always returns before falling off its end.
  throw new Error('bindPort: exhausted candidates without returning — this is a bug');
}

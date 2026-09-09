import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Result } from '../shared/Result.ts';
import { ok, err } from '../shared/Result.ts';
import { loadConfig } from './infrastructure/config/loadConfig.ts';
import type { LoadConfigOptions, LoadedConfig } from './infrastructure/config/loadConfig.ts';
import { buildServer } from './infrastructure/http/server.ts';
import { findPackageRootFrom } from './infrastructure/packageRoot.ts';
import type { BuildServerOptions, TadoruServer } from './infrastructure/http/server.ts';
import { bindPort, AUTO_PORT_RANGE_START } from './infrastructure/http/bindPort.ts';

/**
 * Reports the running package version. The directory walk itself lives in
 * `packageRoot.ts` — a second implementation here is what previously let the
 * dashboard footer report `0.0.0` from the published layout.
 */
export function resolvePackageVersion(
  startDir: string,
  readFile: (path: string) => string = (path) => readFileSync(path, 'utf8'),
): string {
  const packageRoot = findPackageRootFrom(startDir, readFile);
  if (packageRoot === null) return 'unknown';
  try {
    const parsed = JSON.parse(readFile(join(packageRoot, 'package.json'))) as { version?: unknown };
    return typeof parsed.version === 'string' ? parsed.version : 'unknown';
  } catch {
    return 'unknown';
  }
}

const moduleDir = dirname(fileURLToPath(import.meta.url));

/** The real, non-injected version resolver used by the CLI in production. */
export function currentPackageVersion(): string {
  return resolvePackageVersion(moduleDir);
}

export interface RunningApp {
  /** Stops accepting connections, flushes buffered events, and closes the database. Safe to call from a signal handler. */
  close(): Promise<void>;
}

export interface StartAppPorts {
  readonly loadConfig: (options?: LoadConfigOptions) => Result<LoadedConfig, string>;
  readonly buildServer: (options: BuildServerOptions) => TadoruServer;
  readonly log: (message: string) => void;
  readonly logError: (message: string) => void;
  readonly resolveVersion: () => string;
}

/**
 * The composition root for `tadoru start`: loads configuration, refusing to
 * proceed on a missing or placeholder admin password; builds the whole
 * server object graph (HTTP routes, persistence, scheduler) through
 * `buildServer`; binds the configured port (or auto-selects one — see
 * `bindPort.ts`) through the built server's own `listen`; and logs a
 * startup summary that never includes the password hash or the session
 * secret, and always names the port actually bound.
 */
export async function startApp(overrides: Partial<StartAppPorts> = {}): Promise<Result<RunningApp, string>> {
  const ports: StartAppPorts = {
    loadConfig: overrides.loadConfig ?? loadConfig,
    buildServer: overrides.buildServer ?? buildServer,
    log: overrides.log ?? ((message) => console.log(message)),
    logError: overrides.logError ?? ((message) => console.error(message)),
    resolveVersion: overrides.resolveVersion ?? currentPackageVersion,
  };

  const loaded = ports.loadConfig();
  if (!loaded.ok) {
    // Deliberately not logged here: the caller (e.g. `runStartCommand`) owns
    // reporting the error to the operator, so it is not printed twice.
    return loaded;
  }

  const { config, warnings } = loaded.value;
  for (const warning of warnings) {
    ports.log(`Warning: ${warning}`);
  }

  const server = ports.buildServer({ config });
  const bound = await bindPort({
    requestedPort: config.port,
    listen: async (port) => {
      await server.fastify.listen({ port, host: config.host });
    },
  });
  if (!bound.ok) {
    await server.close();
    return err(bound.error);
  }

  const version = ports.resolveVersion();
  const portNote = bound.value.autoSelected
    ? ` (${AUTO_PORT_RANGE_START} was busy; set TADORU_PORT to pin it)`
    : '';
  ports.log(`Tadoru v${version} listening on ${config.host}:${bound.value.port}${portNote}`);
  ports.log(`Data directory: ${config.dataDir}`);
  ports.log(`Sites configured: ${config.sites.length}`);

  return ok({ close: () => server.close() });
}

export interface ShutdownProcessPort {
  on(event: string, callback: () => void): void;
}

export interface ShutdownPorts {
  readonly process: ShutdownProcessPort;
  readonly exit: (code: number) => void;
  readonly log: (message: string) => void;
}

/**
 * Wires SIGTERM and SIGINT to a graceful shutdown: `app.close()` is awaited
 * — which is what makes flushing buffered events and closing the database
 * happen before the process actually exits — and only then is `exit`
 * called. A second signal while shutdown is already underway is ignored
 * rather than starting a second close().
 */
export function installGracefulShutdown(app: RunningApp, ports: ShutdownPorts): void {
  let shuttingDown = false;

  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    ports.log(`Received ${signal}, shutting down gracefully...`);
    app
      .close()
      .then(() => {
        ports.exit(0);
      })
      .catch((error: unknown) => {
        ports.log(`Error during shutdown: ${error instanceof Error ? error.message : String(error)}`);
        ports.exit(1);
      });
  };

  ports.process.on('SIGTERM', () => shutdown('SIGTERM'));
  ports.process.on('SIGINT', () => shutdown('SIGINT'));
}

import type { Result } from '../../shared/Result.ts';
import { installGracefulShutdown, startApp } from '../composition.ts';
import type { RunningApp } from '../composition.ts';

export interface RunStartCommandPorts {
  readonly startApp: () => Promise<Result<RunningApp, string>>;
  readonly installGracefulShutdown: (app: RunningApp) => void;
  readonly logError: (message: string) => void;
}

/**
 * The `tadoru start` CLI command: runs the composition root and, on
 * success, wires SIGTERM/SIGINT to a graceful shutdown. Returns an exit
 * code rather than calling `process.exit` itself, so `bin/tadoru.ts` stays
 * the only place that touches the real process lifecycle. On success the
 * process is expected to keep running (the HTTP server is listening), so a
 * `0` exit code here means "started successfully", not "finished".
 */
export async function runStartCommand(overrides: Partial<RunStartCommandPorts> = {}): Promise<number> {
  const ports: RunStartCommandPorts = {
    startApp: overrides.startApp ?? startApp,
    installGracefulShutdown: overrides.installGracefulShutdown ?? ((app) => installGracefulShutdown(app, realShutdownPorts())),
    logError: overrides.logError ?? ((message) => console.error(message)),
  };

  const result = await ports.startApp();
  if (!result.ok) {
    ports.logError(result.error);
    return 1;
  }

  ports.installGracefulShutdown(result.value);
  return 0;
}

function realShutdownPorts(): { process: NodeJS.Process; exit: (code: number) => void; log: (message: string) => void } {
  return {
    process,
    exit: (code) => process.exit(code),
    log: (message) => console.log(message),
  };
}

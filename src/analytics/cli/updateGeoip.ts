import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import type { Result } from '../../shared/Result.ts';
import { err, ok } from '../../shared/Result.ts';

export interface UpdateProcessResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * Runs `geoip-lite`'s own update script, which downloads a fresh MaxMind
 * GeoLite2 country database over the network. Resolved via `require.resolve`
 * rather than a hardcoded relative path, so it keeps working regardless of
 * how deeply `geoip-lite` is nested in `node_modules`.
 */
function runRealUpdate(): Promise<UpdateProcessResult> {
  return new Promise((resolve, reject) => {
    const require = createRequire(import.meta.url);
    let scriptPath: string;
    try {
      scriptPath = require.resolve('geoip-lite/scripts/updatedb.js');
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)));
      return;
    }

    const child = spawn(process.execPath, [scriptPath], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', (error) => reject(error));
    child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

export interface RunUpdateGeoipOptions {
  readonly runUpdate?: () => Promise<UpdateProcessResult>;
  readonly log: (message: string) => void;
}

/**
 * `tadoru update-geoip`: refreshes the local, offline GeoIP database used
 * by `geoip-lite`. This requires network access, which may be unavailable
 * (an air-gapped host, a firewalled VPS); on failure this reports a clear
 * message rather than letting a raw stack trace reach the operator.
 */
export async function runUpdateGeoip(options: RunUpdateGeoipOptions): Promise<Result<void, string>> {
  const runUpdate = options.runUpdate ?? runRealUpdate;

  let result: UpdateProcessResult;
  try {
    result = await runUpdate();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return err(`Failed to update the GeoIP database: ${message}`);
  }

  if (result.code !== 0) {
    return err(
      `Failed to update the GeoIP database (this requires network access to MaxMind's GeoLite2 ` +
        `download): ${result.stderr.trim() || `update process exited with code ${result.code}`}`,
    );
  }

  options.log('GeoIP database updated.');
  return ok(undefined);
}

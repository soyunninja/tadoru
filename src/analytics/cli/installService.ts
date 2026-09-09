import { readFileSync, writeFileSync } from 'node:fs';
import type { Result } from '../../shared/Result.ts';
import { err, ok } from '../../shared/Result.ts';

const SYSTEMD_UNIT_PATH = '/etc/systemd/system/tadoru.service';
const ENV_FILE_PATH = '/etc/tadoru/tadoru.env';
const DEFAULT_SERVICE_USER = 'tadoru';

/**
 * Matches an actual `MemoryDenyWriteExecute=yes` directive line, but not a
 * comment merely mentioning it (the checked-in template explains in a
 * comment why it must stay absent — that line must survive).
 */
const MEMORY_DENY_WRITE_EXECUTE_LINE_PATTERN = /^\s*MemoryDenyWriteExecute\s*=\s*yes\s*$/;

/**
 * V8's JIT needs writable executable pages; Node refuses to start at all
 * under `MemoryDenyWriteExecute=yes` (see ADR 0003). The checked-in template
 * only carries a comment saying so and never sets it, but this strips the
 * directive defensively at render time regardless of what the template
 * contains, so a future edit to the template can never silently reintroduce
 * a unit that stops Node from starting.
 */
export function stripMemoryDenyWriteExecute(unit: string): string {
  return unit
    .split('\n')
    .filter((line) => !MEMORY_DENY_WRITE_EXECUTE_LINE_PATTERN.test(line))
    .join('\n');
}

export interface RenderUnitFileParams {
  readonly execPath: string;
  readonly user: string;
  readonly dataDir: string;
}

/**
 * Renders the systemd unit from the checked-in template, substituting the
 * resolved binary path, service user/group, and data directory. Always
 * strips `MemoryDenyWriteExecute=yes` from the result regardless of the
 * template's contents.
 */
export function renderUnitFile(template: string, params: RenderUnitFileParams): string {
  let rendered = template;
  rendered = rendered.replace(/^ExecStart=.*$/m, `ExecStart=${params.execPath} start`);
  rendered = rendered.replace(/^User=.*$/m, `User=${params.user}`);
  rendered = rendered.replace(/^Group=.*$/m, `Group=${params.user}`);
  rendered = rendered.replace(/^Environment=TADORU_DATA_DIR=.*$/m, `Environment=TADORU_DATA_DIR=${params.dataDir}`);
  return stripMemoryDenyWriteExecute(rendered);
}

export interface RunInstallServiceOptions {
  readonly platform: NodeJS.Platform | string;
  readonly dryRun: boolean;
  readonly execPath: string;
  readonly dataDir: string;
  readonly user?: string;
  readonly readTemplate: () => string;
  readonly log: (message: string) => void;
  /** Only invoked outside `--dry-run`; never called in the tested path. */
  readonly writeUnitFile?: (path: string, content: string) => void;
}

/**
 * `tadoru install-service`: renders the systemd unit and reports exactly
 * what an install would create. Refuses outright on any non-Linux
 * platform, since systemd itself is Linux-only — this refusal applies even
 * under `--dry-run`. The real (non-dry-run) path performs privileged
 * filesystem writes and is intentionally left untested here; only
 * `--dry-run` is exercised by tests, per the task's testing constraints.
 */
export async function runInstallService(options: RunInstallServiceOptions): Promise<Result<void, string>> {
  if (options.platform !== 'linux') {
    return err(
      `install-service is not supported on "${options.platform}": systemd is Linux-only. ` +
        'Run this command on the Linux server that will host Tadoru.',
    );
  }

  const user = options.user ?? DEFAULT_SERVICE_USER;
  const template = options.readTemplate();
  const rendered = renderUnitFile(template, { execPath: options.execPath, user, dataDir: options.dataDir });

  if (options.dryRun) {
    options.log('--dry-run: nothing was written. This install would create:');
    options.log(`  - ${user} (system user)`);
    options.log(`  - ${SYSTEMD_UNIT_PATH}`);
    options.log(`  - ${ENV_FILE_PATH} (mode 0600)`);
    options.log('');
    options.log('Rendered unit:');
    options.log(rendered);
    return ok(undefined);
  }

  const writeUnitFile = options.writeUnitFile ?? ((path, content) => writeFileSync(path, content));
  writeUnitFile(SYSTEMD_UNIT_PATH, rendered);
  options.log(`Wrote ${SYSTEMD_UNIT_PATH}`);
  options.log(`Create the ${user} system user and ${ENV_FILE_PATH} (mode 0600) if they do not exist yet.`);

  return ok(undefined);
}

export function readSystemdTemplate(templatePath: string): string {
  return readFileSync(templatePath, 'utf8');
}

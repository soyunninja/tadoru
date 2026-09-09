#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { dirname, join } from 'node:path';
import { findPackageRootFrom } from '../src/analytics/infrastructure/packageRoot.ts';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { currentPackageVersion } from '../src/analytics/composition.ts';
import { runStartCommand } from '../src/analytics/cli/start.ts';
import { runInit } from '../src/analytics/cli/init.ts';
import type { PromptPort } from '../src/analytics/cli/init.ts';
import { readSystemdTemplate, runInstallService, ENV_FILE_PATH } from '../src/analytics/cli/installService.ts';
import { runBackup } from '../src/analytics/cli/backup.ts';
import { runUpdateGeoip } from '../src/analytics/cli/updateGeoip.ts';
import { runStatusCommand, inspectDatabaseReadOnly, fetchProbeHealth } from '../src/analytics/cli/status.ts';
import { runRestoreCommand, verifyTadoruDatabaseFile } from '../src/analytics/cli/restore.ts';
import { runResetPassword } from '../src/analytics/cli/resetPassword.ts';
import { loadConfig } from '../src/analytics/infrastructure/config/loadConfig.ts';

const DATABASE_FILE_NAME = 'tadoru.db';

export type ParsedCommand =
  | { readonly kind: 'help'; readonly command?: string }
  | { readonly kind: 'version' }
  | { readonly kind: 'start' }
  | {
      readonly kind: 'init';
      readonly force: boolean;
      readonly domains: string | undefined;
      readonly dataDir: string | undefined;
      readonly port: number | undefined;
    }
  | {
      readonly kind: 'install-service';
      readonly dryRun: boolean;
      readonly sites: string | undefined;
      readonly lang: string | undefined;
    }
  | { readonly kind: 'backup' }
  | { readonly kind: 'update-geoip' }
  | { readonly kind: 'status'; readonly json: boolean }
  | {
      readonly kind: 'restore';
      readonly backupFilePath: string | undefined;
      readonly dryRun: boolean;
      readonly force: boolean;
    }
  | { readonly kind: 'reset-password'; readonly dryRun: boolean }
  | { readonly kind: 'unknown'; readonly name: string };

/**
 * Pure argv -> parsed-command mapping. Kept free of any process/filesystem
 * access so it is trivial to test exhaustively; everything effectful lives
 * in the `run*Command` functions below.
 */
export function parseCli(argv: readonly string[]): ParsedCommand {
  const first = argv[0];
  if (first === undefined || first === '--help' || first === '-h' || first === 'help') {
    return { kind: 'help' };
  }
  if (first === '--version' || first === '-v') {
    return { kind: 'version' };
  }

  const rest = argv.slice(1);

  switch (first) {
    case 'start': {
      const { values } = parseArgs({ args: rest, options: { help: { type: 'boolean' } }, strict: false, allowPositionals: true });
      if (values['help'] === true) return { kind: 'help', command: 'start' };
      return { kind: 'start' };
    }
    case 'init': {
      const { values } = parseArgs({
        args: rest,
        options: {
          force: { type: 'boolean' },
          domains: { type: 'string' },
          'data-dir': { type: 'string' },
          port: { type: 'string' },
          help: { type: 'boolean' },
        },
        strict: false,
        allowPositionals: true,
      });
      if (values['help'] === true) return { kind: 'help', command: 'init' };
      const portRaw = values['port'];
      const port = typeof portRaw === 'string' && portRaw.length > 0 ? Number(portRaw) : undefined;
      return {
        kind: 'init',
        force: values['force'] === true,
        domains: typeof values['domains'] === 'string' ? values['domains'] : undefined,
        dataDir: typeof values['data-dir'] === 'string' ? values['data-dir'] : undefined,
        port,
      };
    }
    case 'install-service': {
      const { values } = parseArgs({
        args: rest,
        options: {
          'dry-run': { type: 'boolean' },
          sites: { type: 'string' },
          lang: { type: 'string' },
          help: { type: 'boolean' },
        },
        strict: false,
        allowPositionals: true,
      });
      if (values['help'] === true) return { kind: 'help', command: 'install-service' };
      return {
        kind: 'install-service',
        dryRun: values['dry-run'] === true,
        sites: typeof values['sites'] === 'string' ? values['sites'] : undefined,
        lang: typeof values['lang'] === 'string' ? values['lang'] : undefined,
      };
    }
    case 'backup': {
      const { values } = parseArgs({ args: rest, options: { help: { type: 'boolean' } }, strict: false, allowPositionals: true });
      if (values['help'] === true) return { kind: 'help', command: 'backup' };
      return { kind: 'backup' };
    }
    case 'update-geoip': {
      const { values } = parseArgs({ args: rest, options: { help: { type: 'boolean' } }, strict: false, allowPositionals: true });
      if (values['help'] === true) return { kind: 'help', command: 'update-geoip' };
      return { kind: 'update-geoip' };
    }
    case 'status': {
      const { values } = parseArgs({
        args: rest,
        options: { json: { type: 'boolean' }, help: { type: 'boolean' } },
        strict: false,
        allowPositionals: true,
      });
      if (values['help'] === true) return { kind: 'help', command: 'status' };
      return { kind: 'status', json: values['json'] === true };
    }
    case 'restore': {
      const { values, positionals } = parseArgs({
        args: rest,
        options: { 'dry-run': { type: 'boolean' }, force: { type: 'boolean' }, help: { type: 'boolean' } },
        strict: false,
        allowPositionals: true,
      });
      if (values['help'] === true) return { kind: 'help', command: 'restore' };
      return {
        kind: 'restore',
        backupFilePath: positionals[0],
        dryRun: values['dry-run'] === true,
        force: values['force'] === true,
      };
    }
    case 'reset-password': {
      const { values } = parseArgs({
        args: rest,
        options: { 'dry-run': { type: 'boolean' }, help: { type: 'boolean' } },
        strict: false,
        allowPositionals: true,
      });
      if (values['help'] === true) return { kind: 'help', command: 'reset-password' };
      return { kind: 'reset-password', dryRun: values['dry-run'] === true };
    }
    default:
      return { kind: 'unknown', name: first };
  }
}

function printUsage(command?: string): void {
  if (command === undefined) {
    console.log(
      [
        'tadoru — cookieless, self-hosted web analytics.',
        '',
        'Usage: tadoru <command> [options]',
        '',
        'Commands:',
        '  init              Interactive setup: writes tadoru.config.json and tadoru.env',
        '  start             Start the analytics server',
        '  install-service   Prepare the machine to run Tadoru under systemd (Linux, root only)',
        '  backup            Vacuum the database into a dated backup file',
        '  restore           Replace the live database with a backup, safely',
        '  reset-password    Generate a new admin password (root only)',
        '  update-geoip      Refresh the local GeoIP database',
        '  status            Report whether the server is running and the database is healthy',
        '',
        'Options:',
        '  -h, --help        Show this help',
        '  -v, --version     Show the installed version',
        '',
        'Run "tadoru <command> --help" for command-specific options.',
      ].join('\n'),
    );
    return;
  }

  const perCommand: Record<string, string> = {
    start: 'tadoru start\n\nStarts the HTTP server and background scheduler using the resolved configuration.',
    init: 'tadoru init [--force] [--domains a.com,b.com] [--data-dir ./data] [--port 3000]\n\nWrites tadoru.config.json and tadoru.env. Prompts interactively when run from a terminal.',
    'install-service':
      'tadoru install-service --sites a.com,b.com [--lang en] [--dry-run]\n\n' +
      'Creates the tadoru system user, /etc/tadoru/tadoru.env (with a generated admin password) ' +
      'and the systemd unit, then reloads systemd. Requires root, and Linux. Does not start or ' +
      'enable the service — run "sudo systemctl enable --now tadoru" yourself when ready.',
    backup: 'tadoru backup\n\nVacuums the database into a dated backup file inside the data directory.',
    restore:
      'tadoru restore <backup-file> [--dry-run] [--force]\n\n' +
      'Replaces the live database with <backup-file>. Refuses to run while a server answers on the ' +
      'configured (or auto-selected) port, refuses a file that is not a valid SQLite database, and ' +
      'refuses one that is valid SQLite but does not carry the schema_migrations/events tables Tadoru ' +
      'expects — restoring the wrong file must be impossible, not merely unlikely. Before replacing ' +
      'anything it moves the current database aside to a dated file, then removes stale -wal/-shm ' +
      'sidecar files so the restored database never starts from an inconsistent journal.\n\n' +
      '--dry-run   Run every check and print the plan; changes nothing on disk.\n' +
      '--force     Skip ONLY the running-server check. DANGEROUS: restoring into a database a live ' +
      'server is writing to can corrupt both the file being replaced and the one being written, and ' +
      'the server may keep stale data cached after the files change underneath it. Every other check ' +
      '(file exists, is SQLite, carries the Tadoru schema) still runs.',
    'reset-password':
      'tadoru reset-password [--dry-run]\n\n' +
      'Generates a fresh admin password and rewrites the credential lines in ' +
      `${ENV_FILE_PATH}, hashed, keeping every other line untouched. Requires root, and requires ` +
      'that file to already exist (run "sudo tadoru install-service" first if it does not). ' +
      'Backs up the existing file to a dated copy alongside it before rewriting. Never accepts ' +
      'a password as an argument: it generates one and prints it once, then asks you to run ' +
      '"sudo systemctl restart tadoru" for it to take effect.\n\n' +
      '--dry-run   Print the plan and perform no refusal-passing effect; still refuses if not ' +
      'root or if the env file is missing.',
    'update-geoip': 'tadoru update-geoip\n\nRefreshes the local GeoIP database. Requires network access.',
    status:
      'tadoru status [--json]\n\n' +
      'Reports whether a server is answering /health, whether the database opens and what it holds, ' +
      'per-site event counts, retention, and scheduled job health. Exits 0 only when a server answered ' +
      'and the database opened successfully, so it doubles as a monitoring check.',
  };
  console.log(perCommand[command] ?? `Unknown command: ${command}`);
}

async function runInitCommand(parsed: Extract<ParsedCommand, { kind: 'init' }>): Promise<number> {
  const cwd = process.cwd();
  const configPath = join(cwd, 'tadoru.config.json');
  const envPath = join(cwd, 'tadoru.env');
  const isInteractive = process.stdin.isTTY === true && process.stdout.isTTY === true;

  const rl = isInteractive ? createInterface({ input: process.stdin, output: process.stdout }) : undefined;
  const prompt: PromptPort | undefined = rl !== undefined ? { question: (query: string) => rl.question(query) } : undefined;

  const result = await runInit({
    configPath,
    envPath,
    force: parsed.force,
    isInteractive,
    prompt,
    flags: { domains: parsed.domains, dataDir: parsed.dataDir, port: parsed.port },
    log: (message) => console.log(message),
  });

  rl?.close();

  if (!result.ok) {
    console.error(result.error);
    return 1;
  }
  return 0;
}

async function runInstallServiceCommand(parsed: Extract<ParsedCommand, { kind: 'install-service' }>): Promise<number> {
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  // Resolution lives in packageRoot.ts: it walks without a depth cap and
  // checks the manifest is ours, which a hand-rolled copy here would not.
  const packageRoot = findPackageRootFrom(moduleDir) ?? moduleDir;
  const templatePath = join(packageRoot, 'deploy', 'tadoru.service');
  const execPath = process.argv[1] ?? 'tadoru';
  const dataDir = process.env['TADORU_DATA_DIR'] ?? '/var/lib/tadoru';
  const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;

  const result = await runInstallService({
    platform: process.platform,
    isRoot,
    dryRun: parsed.dryRun,
    execPath,
    dataDir,
    sites: parsed.sites,
    lang: parsed.lang,
    readTemplate: () => readSystemdTemplate(templatePath),
    log: (message) => console.log(message),
  });

  if (!result.ok) {
    console.error(result.error);
    return 1;
  }
  return 0;
}

async function runBackupCommand(): Promise<number> {
  const dataDir = process.env['TADORU_DATA_DIR'] ?? './data';
  const sourcePath = join(dataDir, DATABASE_FILE_NAME);

  const result = runBackup({ sourcePath, dataDir, log: (message) => console.log(message) });
  if (!result.ok) {
    console.error(result.error);
    return 1;
  }
  return 0;
}

async function runUpdateGeoipCommand(): Promise<number> {
  const result = await runUpdateGeoip({ log: (message) => console.log(message) });
  if (!result.ok) {
    console.error(result.error);
    return 1;
  }
  return 0;
}

async function runStatusCliCommand(parsed: Extract<ParsedCommand, { kind: 'status' }>): Promise<number> {
  return runStatusCommand(
    { json: parsed.json },
    {
      loadConfig,
      resolveVersion: currentPackageVersion,
      inspectDatabase: inspectDatabaseReadOnly,
      probeHealth: fetchProbeHealth,
      now: () => Date.now(),
      log: (message) => console.log(message),
    },
  );
}

async function runRestoreCliCommand(parsed: Extract<ParsedCommand, { kind: 'restore' }>): Promise<number> {
  if (parsed.backupFilePath === undefined) {
    console.error('Usage: tadoru restore <backup-file> [--dry-run] [--force]');
    return 1;
  }

  const result = await runRestoreCommand(
    { backupFilePath: parsed.backupFilePath, dryRun: parsed.dryRun, force: parsed.force },
    {
      loadConfig,
      probeHealth: fetchProbeHealth,
      verifyTadoruDatabase: verifyTadoruDatabaseFile,
      now: () => new Date(),
      log: (message) => console.log(message),
    },
  );

  if (!result.ok) {
    console.error(result.error);
    return 1;
  }
  return 0;
}

async function runResetPasswordCliCommand(parsed: Extract<ParsedCommand, { kind: 'reset-password' }>): Promise<number> {
  const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;

  const result = await runResetPassword({
    isRoot,
    dryRun: parsed.dryRun,
    envFilePath: ENV_FILE_PATH,
    log: (message) => console.log(message),
  });

  if (!result.ok) {
    console.error(result.error);
    return 1;
  }
  return 0;
}

export async function main(argv: readonly string[]): Promise<number> {
  const parsed = parseCli(argv);

  switch (parsed.kind) {
    case 'help':
      printUsage(parsed.command);
      return 0;
    case 'version':
      console.log(currentPackageVersion());
      return 0;
    case 'start':
      return runStartCommand();
    case 'init':
      return runInitCommand(parsed);
    case 'install-service':
      return runInstallServiceCommand(parsed);
    case 'backup':
      return runBackupCommand();
    case 'update-geoip':
      return runUpdateGeoipCommand();
    case 'status':
      return runStatusCliCommand(parsed);
    case 'restore':
      return runRestoreCliCommand(parsed);
    case 'reset-password':
      return runResetPasswordCliCommand(parsed);
    case 'unknown':
      console.error(`Unknown command: ${parsed.name}\n`);
      printUsage();
      return 1;
  }
}

const invokedDirectly = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}

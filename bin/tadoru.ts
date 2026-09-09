#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { dirname, join } from 'node:path';
import { findPackageRootFrom } from '../src/analytics/infrastructure/packageRoot.ts';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { currentPackageVersion } from '../src/analytics/composition.ts';
import { runStartCommand } from '../src/analytics/cli/start.ts';
import { runInit } from '../src/analytics/cli/init.ts';
import type { PromptPort } from '../src/analytics/cli/init.ts';
import { readSystemdTemplate, runInstallService } from '../src/analytics/cli/installService.ts';
import { runBackup } from '../src/analytics/cli/backup.ts';
import { runUpdateGeoip } from '../src/analytics/cli/updateGeoip.ts';

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
  | { readonly kind: 'install-service'; readonly dryRun: boolean }
  | { readonly kind: 'backup' }
  | { readonly kind: 'update-geoip' }
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
        options: { 'dry-run': { type: 'boolean' }, help: { type: 'boolean' } },
        strict: false,
        allowPositionals: true,
      });
      if (values['help'] === true) return { kind: 'help', command: 'install-service' };
      return { kind: 'install-service', dryRun: values['dry-run'] === true };
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
        '  install-service   Render and report a systemd unit (Linux only)',
        '  backup            Vacuum the database into a dated backup file',
        '  update-geoip      Refresh the local GeoIP database',
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
    init: 'tadoru init [--force] [--domains a.com,b.com] [--data-dir ./data] [--port 8080]\n\nWrites tadoru.config.json and tadoru.env. Prompts interactively when run from a terminal.',
    'install-service':
      'tadoru install-service [--dry-run]\n\nRenders and (unless --dry-run) installs the systemd unit. Linux only.',
    backup: 'tadoru backup\n\nVacuums the database into a dated backup file inside the data directory.',
    'update-geoip': 'tadoru update-geoip\n\nRefreshes the local GeoIP database. Requires network access.',
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
  // Resolution lives in packageRoot.ts. A local copy here is how this file
  // ended up with a depth cap and no name check, unlike the tested one.
  const packageRoot = findPackageRootFrom(moduleDir) ?? moduleDir;
  const templatePath = join(packageRoot, 'deploy', 'tadoru.service');
  const execPath = process.argv[1] ?? 'tadoru';
  const dataDir = process.env['TADORU_DATA_DIR'] ?? '/var/lib/tadoru';

  const result = await runInstallService({
    platform: process.platform,
    dryRun: parsed.dryRun,
    execPath,
    dataDir,
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

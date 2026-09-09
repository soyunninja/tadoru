import { randomBytes as nodeRandomBytes } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Result } from '../../shared/Result.ts';
import { err, ok } from '../../shared/Result.ts';
import { ADMIN_PASSWORD_BYTE_LENGTH } from './installService.ts';
import { hashPassword } from '../infrastructure/http/adminAuth.ts';

const ENV_FILE_MODE = 0o600;
const HASH_LINE_PATTERN = /^TADORU_ADMIN_PASSWORD_HASH=/;
const SALT_LINE_PATTERN = /^TADORU_ADMIN_PASSWORD_SALT=/;
const PLAINTEXT_LINE_PATTERN = /^TADORU_ADMIN_PASSWORD=/;

/**
 * Writes the credential file at mode 0600 — it must never be readable by
 * anyone but root, whether it is being created or rewritten.
 *
 * Both calls are needed. `writeFileSync`'s `mode` applies only when it creates
 * the file, so on its own it would be a no-op here: `reset-password` refuses
 * unless the file already exists. The `chmodSync` is what actually tightens an
 * existing file an operator, or a bad umask, left world-readable. Keeping the
 * creation mode as well means the file is never briefly loose in the window
 * before the chmod lands.
 */
export function writeEnvFileToDisk(path: string, content: string): void {
  writeFileSync(path, content, { mode: ENV_FILE_MODE });
  chmodSync(path, ENV_FILE_MODE);
}

/** Formats a date as `tadoru.env.bak-YYYY-MM-DDTHH-MM-SS`, mirroring `restore.ts`'s `preRestoreFileName`. */
export function envBackupFileName(date: Date): string {
  const iso = date.toISOString(); // e.g. 2026-09-09T10:20:30.000Z
  const withoutMillis = iso.slice(0, 19); // 2026-09-09T10:20:30
  return `tadoru.env.bak-${withoutMillis.replaceAll(':', '-')}`;
}

/** The backup lives next to the env file it was copied from, not in the data directory. */
export function resolveEnvBackupPath(envFilePath: string, fileName: string): string {
  return join(dirname(envFilePath), fileName);
}

/**
 * Rewrites only the credential lines of an existing `tadoru.env` file,
 * carrying every other line — comments, blank lines, operator-added
 * settings — through unchanged and in place.
 *
 * An existing `TADORU_ADMIN_PASSWORD_HASH`/`TADORU_ADMIN_PASSWORD_SALT` line
 * is replaced in place. An old plaintext `TADORU_ADMIN_PASSWORD` line (from
 * an installation predating this feature) is removed and replaced, at the
 * same position, with the new hash+salt pair. If no credential line exists
 * at all, the pair is appended at the end.
 *
 * Whichever position wins, the result carries exactly one hash line and one
 * salt line: a file part-way through the migration can hold both a plaintext
 * line and a hash+salt pair, and emitting the new values once per match would
 * make the file grow a duplicate pair on every reset.
 */
export function rewriteCredentialLines(content: string, passwordHash: string, passwordSalt: string): string {
  const hasTrailingNewline = content.endsWith('\n');
  const lines = content.split('\n');
  if (hasTrailingNewline) lines.pop();

  const hashLine = `TADORU_ADMIN_PASSWORD_HASH=${passwordHash}`;
  const saltLine = `TADORU_ADMIN_PASSWORD_SALT=${passwordSalt}`;
  let hashInserted = false;
  let saltInserted = false;
  const result: string[] = [];

  for (const line of lines) {
    if (HASH_LINE_PATTERN.test(line)) {
      if (!hashInserted) {
        result.push(hashLine);
        hashInserted = true;
      }
    } else if (SALT_LINE_PATTERN.test(line)) {
      if (!saltInserted) {
        result.push(saltLine);
        saltInserted = true;
      }
    } else if (PLAINTEXT_LINE_PATTERN.test(line)) {
      if (!hashInserted) {
        result.push(hashLine);
        hashInserted = true;
      }
      if (!saltInserted) {
        result.push(saltLine);
        saltInserted = true;
      }
    } else {
      result.push(line);
    }
  }

  if (!hashInserted) result.push(hashLine);
  if (!saltInserted) result.push(saltLine);

  return result.join('\n') + (hasTrailingNewline ? '\n' : '');
}

function defaultPathExists(path: string): boolean {
  return existsSync(path);
}

function defaultReadEnvFile(path: string): string {
  return readFileSync(path, 'utf8');
}

function defaultBackupEnvFile(sourcePath: string, backupPath: string): void {
  copyFileSync(sourcePath, backupPath);
}

export interface RunResetPasswordOptions {
  /** Whether the current process is running as root (`process.getuid() === 0`). */
  readonly isRoot: boolean;
  readonly dryRun: boolean;
  /** Defaults to `/etc/tadoru/tadoru.env` in production; injected in tests. */
  readonly envFilePath: string;
  readonly log: (message: string) => void;
  readonly randomBytes?: (size: number) => Uint8Array;
  readonly pathExists?: (path: string) => boolean;
  readonly readEnvFile?: (path: string) => string;
  readonly backupEnvFile?: (sourcePath: string, backupPath: string) => void;
  readonly writeEnvFile?: (path: string, content: string) => void;
  readonly now?: () => Date;
}

/**
 * `tadoru reset-password`: generates a fresh admin password and rewrites it,
 * hashed, into the existing `tadoru.env` file — for when the current one is
 * lost. Deliberately never accepts a password as an argument: the caller
 * only ever gets to read the newly generated one back through `log`, so it
 * can never appear in a shell history or process list.
 *
 * Requires root (the file is 0600 and root-owned) and requires the env file
 * to already exist (this command edits one `install-service` created; it
 * does not create one from scratch). Both refusals apply even under
 * `--dry-run`, which otherwise performs no port call at all.
 */
export async function runResetPassword(options: RunResetPasswordOptions): Promise<Result<void, string>> {
  if (!options.isRoot) {
    return err('reset-password must be run as root. Re-run it with sudo: sudo tadoru reset-password');
  }

  const pathExists = options.pathExists ?? defaultPathExists;
  if (!pathExists(options.envFilePath)) {
    return err(
      `${options.envFilePath} does not exist. Run "sudo tadoru install-service" first to create it.`,
    );
  }

  if (options.dryRun) {
    options.log('--dry-run: nothing was written. This would, in order:');
    options.log(`  1. Back up ${options.envFilePath} to a dated copy alongside it`);
    options.log('  2. Generate a new admin password');
    options.log(`  3. Rewrite only the credential lines in ${options.envFilePath}, keeping everything else`);
    options.log('  4. Print the new password once');
    options.log('  5. Remind you to run: sudo systemctl restart tadoru');
    return ok(undefined);
  }

  const readEnvFile = options.readEnvFile ?? defaultReadEnvFile;
  const backupEnvFile = options.backupEnvFile ?? defaultBackupEnvFile;
  const writeEnvFile = options.writeEnvFile ?? writeEnvFileToDisk;
  const randomBytesFn = options.randomBytes ?? nodeRandomBytes;
  const now = options.now ?? (() => new Date());

  const currentContent = readEnvFile(options.envFilePath);

  const backupPath = resolveEnvBackupPath(options.envFilePath, envBackupFileName(now()));
  backupEnvFile(options.envFilePath, backupPath);
  options.log(`Backed up ${options.envFilePath} to ${backupPath}`);

  const newPassword = Buffer.from(randomBytesFn(ADMIN_PASSWORD_BYTE_LENGTH)).toString('base64url');
  const { hash: passwordHash, salt: passwordSalt } = hashPassword(newPassword);

  const newContent = rewriteCredentialLines(currentContent, passwordHash, passwordSalt);
  writeEnvFile(options.envFilePath, newContent);
  options.log(`Rewrote the admin credential in ${options.envFilePath}.`);

  options.log('');
  options.log(`New admin password: ${newPassword}`);
  options.log('This password will not be shown again — store it somewhere safe now.');
  options.log('');
  options.log('Run this for it to take effect:');
  options.log('  sudo systemctl restart tadoru');

  return ok(undefined);
}

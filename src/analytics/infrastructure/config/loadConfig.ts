import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Result } from '../../../shared/Result.ts';
import { ok, err } from '../../../shared/Result.ts';
import { createSiteId } from '../../domain/event/SiteId.ts';
import type { SiteId } from '../../domain/event/SiteId.ts';
import { hashPassword, SCRYPT_KEY_LENGTH, SALT_BYTE_LENGTH } from '../http/adminAuth.ts';
import { isSupportedLocale } from '../i18n/Locale.ts';
import type { Locale } from '../i18n/Locale.ts';
import type { Config } from './Config.ts';
import {
  DEFAULT_HOST,
  DEFAULT_DATA_DIR,
  DEFAULT_TRUSTED_PROXY,
  DEFAULT_RETENTION_RAW_EVENT_MONTHS,
  DEFAULT_SESSION_INACTIVITY_MINUTES,
  RETENTION_WARNING_THRESHOLD_MONTHS,
  KNOWN_EXAMPLE_ADMIN_PASSWORDS,
  SESSION_SECRET_FILE_NAME,
} from './Config.ts';

const SESSION_SECRET_BYTE_LENGTH = 32;

const PASSWORD_HASH_HEX_LENGTH = SCRYPT_KEY_LENGTH * 2;
const PASSWORD_SALT_HEX_LENGTH = SALT_BYTE_LENGTH * 2;
const HEX_PATTERN = /^[0-9a-f]+$/i;

/**
 * A pre-hashed credential is only usable if it is hex of the exact length
 * `hashPassword` produces. Anything else — a placeholder, a truncated
 * copy-paste, a value from a different tool — can never match a real password,
 * so accepting it would mean booting a server whose every login fails with no
 * explanation. Refusing at load time turns that silent lockout into a message.
 */
function isWellFormedCredentialHex(value: string, expectedLength: number): boolean {
  return value.length === expectedLength && HEX_PATTERN.test(value);
}

/** Shape accepted from `tadoru.config.json`. Every field is optional: the file may set none, some, or all of them. */
interface ConfigFileShape {
  readonly port?: number;
  readonly host?: string;
  readonly dataDir?: string;
  readonly sites?: readonly string[];
  readonly trustedProxy?: boolean;
  readonly retention?: { readonly rawEventMonths?: number };
  readonly session?: { readonly inactivityMinutes?: number };
  readonly adminPassword?: string;
}

export interface LoadConfigOptions {
  /** Defaults to `process.env`. Injectable so tests never touch real environment variables. */
  readonly env?: NodeJS.ProcessEnv;
  /** Defaults to `<cwd>/tadoru.config.json`. It is fine for this file not to exist. */
  readonly configFilePath?: string;
}

export interface LoadedConfig {
  readonly config: Config;
  readonly warnings: readonly string[];
}

function readConfigFile(path: string): ConfigFileShape {
  try {
    const raw = readFileSync(path, 'utf8');
    return JSON.parse(raw) as ConfigFileShape;
  } catch {
    // Missing, unreadable or malformed: treated as "no file layer", same as
    // if the operator had not created one yet.
    return {};
  }
}

function parseBoolean(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  return value === 'true' || value === '1';
}

function parseSites(raw: readonly string[] | undefined): readonly SiteId[] {
  if (raw === undefined) return [];
  const normalised = new Set<SiteId>();
  for (const candidate of raw) {
    const result = createSiteId(candidate);
    if (result.ok) {
      normalised.add(result.value);
    }
  }
  return [...normalised];
}

/** `TADORU_LANG`, if set to one of the supported locale codes; otherwise `undefined`, leaving per-request negotiation to `Accept-Language`. */
function parseLanguageEnv(value: string | undefined): Locale | undefined {
  return value !== undefined && isSupportedLocale(value) ? value : undefined;
}

function isKnownExamplePassword(password: string): boolean {
  const normalised = password.trim().toLowerCase();
  return (KNOWN_EXAMPLE_ADMIN_PASSWORDS as readonly string[]).includes(normalised);
}

function resolveSessionSecret(env: NodeJS.ProcessEnv, dataDir: string): string {
  const fromEnv = env['TADORU_SESSION_SECRET'];
  if (fromEnv !== undefined && fromEnv.length > 0) {
    return fromEnv;
  }

  const secretPath = join(dataDir, SESSION_SECRET_FILE_NAME);
  try {
    const existing = readFileSync(secretPath, 'utf8').trim();
    if (existing.length > 0) {
      return existing;
    }
  } catch {
    // No secret persisted yet: fall through and generate one.
  }

  const generated = randomBytes(SESSION_SECRET_BYTE_LENGTH).toString('hex');
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(secretPath, generated, { mode: 0o600 });
  return generated;
}

/**
 * Loads configuration in three layers, later ones winning: built-in
 * defaults, then `tadoru.config.json` if present, then environment
 * variables. Refuses to load with a default or missing admin secret — see
 * AGENTS.md invariant on never shipping a default secret — and warns
 * (without failing) when raw event retention exceeds the window the EU
 * audience-measurement consent exemption assumes.
 */
export function loadConfig(options: LoadConfigOptions = {}): Result<LoadedConfig, string> {
  const env = options.env ?? process.env;
  const configFilePath = options.configFilePath ?? join(process.cwd(), 'tadoru.config.json');
  const fileConfig = readConfigFile(configFilePath);

  // `undefined` here (neither layer set one) is deliberate: it means "pick a port
  // automatically" rather than defaulting to a fixed number — see `bindPort.ts`.
  const port = env['TADORU_PORT'] !== undefined ? Number(env['TADORU_PORT']) : fileConfig.port;
  const host = env['TADORU_HOST'] ?? fileConfig.host ?? DEFAULT_HOST;
  const dataDir = env['TADORU_DATA_DIR'] ?? fileConfig.dataDir ?? DEFAULT_DATA_DIR;
  const trustedProxy = parseBoolean(env['TADORU_TRUSTED_PROXY']) ?? fileConfig.trustedProxy ?? DEFAULT_TRUSTED_PROXY;

  const sitesFromEnv = env['TADORU_SITES']?.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
  const sites = parseSites(sitesFromEnv ?? fileConfig.sites);

  const rawEventMonths =
    env['TADORU_RETENTION_MONTHS'] !== undefined
      ? Number(env['TADORU_RETENTION_MONTHS'])
      : (fileConfig.retention?.rawEventMonths ?? DEFAULT_RETENTION_RAW_EVENT_MONTHS);

  const inactivityMinutes = fileConfig.session?.inactivityMinutes ?? DEFAULT_SESSION_INACTIVITY_MINUTES;

  const language = parseLanguageEnv(env['TADORU_LANG']);

  const passwordHashEnv = env['TADORU_ADMIN_PASSWORD_HASH'];
  const passwordSaltEnv = env['TADORU_ADMIN_PASSWORD_SALT'];
  const hasPasswordHash = passwordHashEnv !== undefined && passwordHashEnv.length > 0;
  const hasPasswordSalt = passwordSaltEnv !== undefined && passwordSaltEnv.length > 0;

  if (hasPasswordHash && !hasPasswordSalt) {
    return err(
      'TADORU_ADMIN_PASSWORD_HASH is set but TADORU_ADMIN_PASSWORD_SALT is missing. Both must ' +
        'be configured together — run "tadoru reset-password" to generate a matching pair.',
    );
  }
  if (hasPasswordSalt && !hasPasswordHash) {
    return err(
      'TADORU_ADMIN_PASSWORD_SALT is set but TADORU_ADMIN_PASSWORD_HASH is missing. Both must ' +
        'be configured together — run "tadoru reset-password" to generate a matching pair.',
    );
  }

  let passwordHash: string;
  let passwordSalt: string;

  if (hasPasswordHash && hasPasswordSalt) {
    // The pre-hashed pair wins over plaintext whenever both are present. This is what
    // `install-service` and `reset-password` now write, so it is the common case, not the
    // exception; and preferring it means a leftover plaintext TADORU_ADMIN_PASSWORD (from
    // hand-editing, or from before this file existed) never silently overrides a freshly
    // rotated hash+salt pair sitting right next to it on disk.
    if (!isWellFormedCredentialHex(passwordHashEnv, PASSWORD_HASH_HEX_LENGTH)) {
      return err(
        `TADORU_ADMIN_PASSWORD_HASH is not a usable credential hash: it must be exactly ` +
          `${PASSWORD_HASH_HEX_LENGTH} hexadecimal characters. The value in ` +
          'deploy/tadoru.env.example is a placeholder, not a working credential. Generate a real ' +
          'pair with: sudo tadoru reset-password',
      );
    }
    if (!isWellFormedCredentialHex(passwordSaltEnv, PASSWORD_SALT_HEX_LENGTH)) {
      return err(
        `TADORU_ADMIN_PASSWORD_SALT is not a usable credential salt: it must be exactly ` +
          `${PASSWORD_SALT_HEX_LENGTH} hexadecimal characters. The value in ` +
          'deploy/tadoru.env.example is a placeholder, not a working credential. Generate a real ' +
          'pair with: sudo tadoru reset-password',
      );
    }

    passwordHash = passwordHashEnv;
    passwordSalt = passwordSaltEnv;
  } else {
    const adminPassword = env['TADORU_ADMIN_PASSWORD'] ?? fileConfig.adminPassword ?? '';

    if (adminPassword.trim().length === 0) {
      return err(
        'Admin password is missing. Set TADORU_ADMIN_PASSWORD (or "adminPassword" in ' +
          'tadoru.config.json) to a strong, unique value. Generate one with, for example: ' +
          "openssl rand -base64 24",
      );
    }
    if (isKnownExamplePassword(adminPassword)) {
      return err(
        `Admin password "${adminPassword}" is a known example value and must never be used. ` +
          'Generate a real one with, for example: openssl rand -base64 24',
      );
    }

    const hashed = hashPassword(adminPassword);
    passwordHash = hashed.hash;
    passwordSalt = hashed.salt;
  }

  const sessionSecret = resolveSessionSecret(env, dataDir);

  const warnings: string[] = [];
  if (rawEventMonths > RETENTION_WARNING_THRESHOLD_MONTHS) {
    warnings.push(
      `retention.rawEventMonths is set to ${rawEventMonths}, beyond the ${RETENTION_WARNING_THRESHOLD_MONTHS}-month ` +
        'window the EU audience-measurement consent exemption assumes. Beyond that window, the consent ' +
        'exemption no longer applies and a consent banner is required.',
    );
  }

  const config: Config = {
    ...(port !== undefined ? { port } : {}),
    host,
    dataDir,
    sites,
    trustedProxy,
    retention: { rawEventMonths },
    session: { inactivityMinutes, secret: sessionSecret },
    admin: { passwordHash, passwordSalt },
    ...(language !== undefined ? { language } : {}),
  };

  return ok({ config, warnings });
}

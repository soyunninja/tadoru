import type { SiteId } from '../../domain/event/SiteId.ts';

/**
 * Fully-resolved, validated runtime configuration. Every field here has
 * already been through defaults, file, and environment layering — nothing
 * downstream needs to know where a value came from.
 */
export interface Config {
  readonly port: number;
  readonly host: string;
  readonly dataDir: string;
  readonly sites: readonly SiteId[];
  readonly trustedProxy: boolean;
  readonly retention: RetentionConfig;
  readonly session: SessionConfig;
  readonly admin: AdminConfig;
}

export interface RetentionConfig {
  readonly rawEventMonths: number;
}

export interface SessionConfig {
  readonly inactivityMinutes: number;
  /** HMAC key for signing session cookies. Generated once and persisted to disk. */
  readonly secret: string;
}

export interface AdminConfig {
  /** scrypt hash (hex) of the configured admin password. Never the plaintext value. */
  readonly passwordHash: string;
  /** scrypt salt (hex) paired with `passwordHash`. */
  readonly passwordSalt: string;
}

export const DEFAULT_PORT = 8080;
/**
 * Loopback by default. The documented deployment puts a reverse proxy in front,
 * and the service needs no capabilities of its own, so there is no reason to
 * accept connections from outside the machine unless an operator asks for it.
 * Getting this wrong exposes the admin dashboard to the internet, so the unsafe
 * option has to be the deliberate one.
 */
export const DEFAULT_HOST = '127.0.0.1';
export const DEFAULT_DATA_DIR = './data';
export const DEFAULT_TRUSTED_PROXY = false;
export const DEFAULT_RETENTION_RAW_EVENT_MONTHS = 25;
export const DEFAULT_SESSION_INACTIVITY_MINUTES = 30;

/**
 * Past this many months, the EU audience-measurement consent exemption no
 * longer applies (see docs/compliance.md and invariant 7 in AGENTS.md).
 */
export const RETENTION_WARNING_THRESHOLD_MONTHS = 25;

/**
 * Values a careless install would ship verbatim from example config or
 * documentation. Refusing them is what keeps a default secret from ever
 * reaching production.
 */
export const KNOWN_EXAMPLE_ADMIN_PASSWORDS = ['change-me', 'cambiame', 'changeme'] as const;

export const SESSION_SECRET_FILE_NAME = 'session-secret';

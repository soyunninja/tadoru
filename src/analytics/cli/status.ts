import { statSync } from 'node:fs';
import { join } from 'node:path';
import DatabaseConstructor from 'better-sqlite3';
import type { Result } from '../../shared/Result.ts';
import { err, ok } from '../../shared/Result.ts';
import type { LoadConfigOptions, LoadedConfig } from '../infrastructure/config/loadConfig.ts';
import { RETENTION_WARNING_THRESHOLD_MONTHS } from '../infrastructure/config/Config.ts';
import { candidatePorts } from '../infrastructure/http/bindPort.ts';
import { SqliteSiteRegistry } from '../infrastructure/persistence/sqlite/SqliteSiteRegistry.ts';
import type { SiteId } from '../domain/event/SiteId.ts';

export const DATABASE_FILE_NAME = 'tadoru.db';
/** Kept short: `status` is a monitoring check, so a dead server should be reported in well under a second, not hung on. */
const PROBE_TIMEOUT_MS = 1500;
/**
 * Consulted only by `tadoru status`, run by a human on their own machine — the
 * running service itself makes no outbound request. See
 * `specs/operations/spec.md` for the invariant this upholds.
 */
const NPM_REGISTRY_LATEST_VERSION_URL = 'https://registry.npmjs.org/tadoru/latest';

// ---------------------------------------------------------------------------
// Ports
// ---------------------------------------------------------------------------

export interface SiteDatabaseStats {
  readonly domain: string;
  readonly eventCount: number;
  /** Epoch seconds of the site's most recent event, or `undefined` if it has never received one. */
  readonly lastEventAt: number | undefined;
}

export interface DatabaseInspection {
  readonly byteSize: number;
  readonly totalEventCount: number;
  /** Epoch seconds of the oldest and newest stored event, or `undefined` if the database has no events. */
  readonly oldestEventAt: number | undefined;
  readonly newestEventAt: number | undefined;
  readonly sites: readonly SiteDatabaseStats[];
}

/** Opens the database strictly read-only, so `status` can never interfere with the live server or corrupt anything. */
export type InspectDatabasePort = (path: string, sites: readonly SiteId[]) => Result<DatabaseInspection, string>;

export interface JobHealthBody {
  readonly lastRunAt: number | null;
  readonly hasRun: boolean;
  readonly lastRunFailed: boolean;
  readonly intervalMs: number;
  readonly stale: boolean;
}

export interface HealthBody {
  readonly status: string;
  readonly database: { readonly reachable: boolean };
  readonly jobs: Readonly<Record<string, JobHealthBody>>;
}

/** Probes one host/port pair's `/health` endpoint, returning the parsed body or `undefined` if nothing answered (connection refused, timeout — never a thrown error). */
export type ProbeHealthPort = (host: string, port: number) => Promise<HealthBody | undefined>;

/** Fetches the latest published version string from the npm registry, or `undefined` if it could not be determined (unreachable, slow, or an unexpected body — never a thrown error). */
export type FetchLatestVersionPort = () => Promise<string | undefined>;

export interface StatusPorts {
  readonly loadConfig: (options?: LoadConfigOptions) => Result<LoadedConfig, string>;
  readonly resolveVersion: () => string;
  readonly inspectDatabase: InspectDatabasePort;
  readonly probeHealth: ProbeHealthPort;
  readonly fetchLatestVersion: FetchLatestVersionPort;
  readonly now: () => number;
  readonly log: (message: string) => void;
}

// ---------------------------------------------------------------------------
// Real (effectful) port implementations
// ---------------------------------------------------------------------------

/**
 * Opens `path` strictly read-only (`fileMustExist` too, so a missing file is
 * a clean `err(...)` rather than silently creating an empty database) and
 * reports byte size, total event counts, and per-configured-site counts.
 * Never mutates the database — safe to run against a live server's file.
 */
export function inspectDatabaseReadOnly(path: string, sites: readonly SiteId[]): Result<DatabaseInspection, string> {
  let db: InstanceType<typeof DatabaseConstructor>;
  try {
    db = new DatabaseConstructor(path, { readonly: true, fileMustExist: true });
  } catch (error) {
    return err(`Cannot open database at ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }

  try {
    const byteSize = statSync(path).size;
    const totals = db
      .prepare('SELECT COUNT(*) AS count, MIN(ts) AS oldest, MAX(ts) AS newest FROM events')
      .get() as { count: number; oldest: number | null; newest: number | null };

    const siteRegistry = new SqliteSiteRegistry(db);
    const perSite = db.prepare('SELECT COUNT(*) AS count, MAX(ts) AS last FROM events WHERE site_id = ?');

    const siteStats: SiteDatabaseStats[] = sites.map((domain) => {
      const siteRowId = siteRegistry.existingIdFor(domain);
      if (siteRowId === undefined) {
        return { domain, eventCount: 0, lastEventAt: undefined };
      }
      const row = perSite.get(siteRowId) as { count: number; last: number | null };
      return { domain, eventCount: row.count, lastEventAt: row.last ?? undefined };
    });

    return ok({
      byteSize,
      totalEventCount: totals.count,
      oldestEventAt: totals.oldest ?? undefined,
      newestEventAt: totals.newest ?? undefined,
      sites: siteStats,
    });
  } catch (error) {
    return err(`Failed to read database at ${path}: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    db.close();
  }
}

/**
 * A configured `0.0.0.0` binds every interface, but is not itself a valid
 * address to connect *to* on every platform — the client-side equivalent is
 * always loopback.
 */
export function probeableHost(configuredHost: string): string {
  return configuredHost === '0.0.0.0' ? '127.0.0.1' : configuredHost;
}

/**
 * Narrows an arbitrary JSON body to our own health shape, or `undefined`.
 *
 * A 200 with valid JSON is not proof the responder is Tadoru. With no port
 * configured this command probes 3000-3009 — the busiest range on any developer
 * machine — so an unrelated dev server answering JSON is the expected case, not
 * a hypothetical. Casting blind turned `tadoru status` into a stack trace at the
 * exact moment someone runs it to find out what is wrong.
 */
export function asHealthBody(body: unknown): HealthBody | undefined {
  if (typeof body !== 'object' || body === null) return undefined;
  const candidate = body as Partial<HealthBody>;

  const database: unknown = candidate.database;
  if (typeof database !== 'object' || database === null) return undefined;
  if (typeof (database as { reachable?: unknown }).reachable !== 'boolean') return undefined;

  const jobs: unknown = candidate.jobs;
  if (typeof jobs !== 'object' || jobs === null) return undefined;

  return candidate as HealthBody;
}

/** Real, `fetch`-based health probe with a short timeout, so a dead server is reported quickly rather than hanging the whole command. */
export async function fetchProbeHealth(host: string, port: number): Promise<HealthBody | undefined> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const response = await fetch(`http://${host}:${port}/health`, { signal: controller.signal });
    return asHealthBody(await response.json());
  } catch {
    // Connection refused, timed out, or an unparsable body: from the
    // operator's point of view all of these mean "nothing answered here".
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Narrows an arbitrary JSON body from the npm registry to the one field we
 * need, or `undefined`. Same defensive pattern as `asHealthBody`: a 200 with
 * valid JSON is not proof it carries a `version` field (rate limiting and
 * registry error bodies both return JSON), and casting blind would turn a
 * flaky registry into a crash in a command meant to be a safe monitoring check.
 */
export function asLatestVersionInfo(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null) return undefined;
  const version = (body as { version?: unknown }).version;
  return typeof version === 'string' ? version : undefined;
}

/**
 * Compares two version strings, accepting only plain `x.y.z` (three
 * non-negative integers). Anything else — a prerelease tag, a `v` prefix, a
 * missing or extra segment, a non-numeric part — on either side is
 * `'not-comparable'`: guessing at an update that may not exist is worse than
 * saying nothing.
 */
export function compareVersions(current: string, latest: string): 'up-to-date' | 'update-available' | 'not-comparable' {
  const currentParts = parsePlainVersion(current);
  const latestParts = parsePlainVersion(latest);
  if (currentParts === undefined || latestParts === undefined) return 'not-comparable';

  for (let i = 0; i < 3; i++) {
    const latestPart = latestParts[i] as number;
    const currentPart = currentParts[i] as number;
    if (latestPart > currentPart) return 'update-available';
    if (latestPart < currentPart) return 'up-to-date';
  }
  return 'up-to-date';
}

function parsePlainVersion(version: string): readonly [number, number, number] | undefined {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (match === null) return undefined;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/**
 * Real, `fetch`-based lookup of the latest published version from the npm
 * registry, with the same short-timeout shape as `fetchProbeHealth`. Called
 * only by `tadoru status`, a human-run CLI command — the running service
 * itself makes no outbound request. `fetchImpl` and `timeoutMs` are
 * injectable seams so tests can exercise failure shapes without monkeypatching
 * `globalThis.fetch` or waiting out a real timeout.
 */
export async function fetchLatestPublishedVersion(
  fetchImpl: typeof fetch = fetch,
  timeoutMs: number = PROBE_TIMEOUT_MS,
): Promise<string | undefined> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(NPM_REGISTRY_LATEST_VERSION_URL, { signal: controller.signal });
    return asLatestVersionInfo(await response.json());
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Report shape
// ---------------------------------------------------------------------------

export interface StatusReportJob {
  readonly name: string;
  readonly lastRunAt: number | null;
  readonly hasRun: boolean;
  readonly lastRunFailed: boolean;
  readonly stale: boolean;
  readonly intervalMs: number;
}

export type DatabaseReport =
  | {
      readonly ok: true;
      readonly byteSize: number;
      readonly totalEventCount: number;
      readonly oldestEventAt: number | undefined;
      readonly newestEventAt: number | undefined;
    }
  | { readonly ok: false; readonly error: string };

/** Whether a newer version has been published to the npm registry, as reported by `tadoru status`. */
export type UpdateCheckReport =
  | { readonly status: 'disabled' }
  | { readonly status: 'unavailable'; readonly reason: string }
  | {
      readonly status: 'up-to-date' | 'update-available' | 'not-comparable';
      readonly currentVersion: string;
      readonly latestVersion: string;
    };

export interface StatusReport {
  readonly version: string;
  readonly dataDir: string;
  readonly server: { readonly answering: boolean; readonly port: number | undefined };
  readonly database: DatabaseReport;
  readonly sites: readonly SiteDatabaseStats[];
  readonly retention: { readonly months: number; readonly exceedsExemptionWindow: boolean };
  /** `undefined` when no server answered — job state must never be fabricated in that case. */
  readonly jobs: readonly StatusReportJob[] | undefined;
  readonly updateCheck: UpdateCheckReport;
}

function jobsFromHealthBody(body: HealthBody): readonly StatusReportJob[] {
  return Object.entries(body.jobs).map(([name, job]) => ({
    name,
    lastRunAt: job.lastRunAt,
    hasRun: job.hasRun,
    lastRunFailed: job.lastRunFailed,
    stale: job.stale,
    intervalMs: job.intervalMs,
  }));
}

/**
 * Resolves the update-check section of the report. Never throws: the port
 * contract guarantees `fetchLatestVersion` resolves rather than rejects, and
 * an unreachable or unexpected registry response is reported as a fact, not
 * an exception — the update check must never be able to break `status`.
 */
async function resolveUpdateCheck(
  currentVersion: string,
  checkForUpdates: boolean,
  fetchLatestVersion: FetchLatestVersionPort,
): Promise<UpdateCheckReport> {
  if (!checkForUpdates) return { status: 'disabled' };
  const latestVersion = await fetchLatestVersion();
  if (latestVersion === undefined) return { status: 'unavailable', reason: 'could not reach the npm registry' };
  return { status: compareVersions(currentVersion, latestVersion), currentVersion, latestVersion };
}

/**
 * Builds the full status report by consulting every port. Never throws: a
 * failing database inspection or an unanswering server are reported as
 * facts inside the returned report, not as exceptions.
 */
export async function buildStatusReport(
  config: LoadedConfig['config'],
  ports: StatusPorts,
  checkForUpdates: boolean = true,
): Promise<StatusReport> {
  const version = ports.resolveVersion();
  const probeHost = probeableHost(config.host);

  let answeringPort: number | undefined;
  let healthBody: HealthBody | undefined;
  for (const port of candidatePorts(config.port)) {
    const body = await ports.probeHealth(probeHost, port);
    if (body !== undefined) {
      answeringPort = port;
      healthBody = body;
      break;
    }
  }

  const databasePath = join(config.dataDir, DATABASE_FILE_NAME);
  const inspection = ports.inspectDatabase(databasePath, config.sites);
  const database: DatabaseReport = inspection.ok
    ? {
        ok: true,
        byteSize: inspection.value.byteSize,
        totalEventCount: inspection.value.totalEventCount,
        oldestEventAt: inspection.value.oldestEventAt,
        newestEventAt: inspection.value.newestEventAt,
      }
    : { ok: false, error: inspection.error };

  const updateCheck = await resolveUpdateCheck(version, checkForUpdates, ports.fetchLatestVersion);

  return {
    version,
    dataDir: config.dataDir,
    server: { answering: healthBody !== undefined, port: answeringPort },
    database,
    sites: inspection.ok ? inspection.value.sites : config.sites.map((domain) => ({ domain, eventCount: 0, lastEventAt: undefined })),
    retention: {
      months: config.retention.rawEventMonths,
      exceedsExemptionWindow: config.retention.rawEventMonths > RETENTION_WARNING_THRESHOLD_MONTHS,
    },
    jobs: healthBody !== undefined ? jobsFromHealthBody(healthBody) : undefined,
    updateCheck,
  };
}

// ---------------------------------------------------------------------------
// Text rendering
// ---------------------------------------------------------------------------

function formatEpochSeconds(epochSeconds: number): string {
  return new Date(epochSeconds * 1000).toISOString();
}

function formatEpochMillis(epochMillis: number): string {
  return new Date(epochMillis).toISOString();
}

function renderTextReport(report: StatusReport): string {
  const lines: string[] = [];

  lines.push(`Tadoru v${report.version}`);
  lines.push(`Data directory: ${report.dataDir}`);
  lines.push('');

  switch (report.updateCheck.status) {
    case 'disabled':
      lines.push('Update check: skipped (--no-update-check)');
      break;
    case 'unavailable':
      lines.push(`Update check: could not check (${report.updateCheck.reason})`);
      break;
    case 'up-to-date':
      lines.push(`Tadoru is up to date (v${report.updateCheck.currentVersion}).`);
      break;
    case 'update-available':
      lines.push(
        `A newer version is available: v${report.updateCheck.latestVersion} (running v${report.updateCheck.currentVersion}).`,
      );
      lines.push('Upgrade with: sudo npm update -g tadoru && sudo systemctl restart tadoru');
      break;
    case 'not-comparable':
      lines.push(
        `Update check: could not compare versions (running v${report.updateCheck.currentVersion}, registry reports ` +
          `v${report.updateCheck.latestVersion}).`,
      );
      break;
  }
  lines.push('');

  lines.push(
    report.server.answering && report.server.port !== undefined
      ? `Server: answering on port ${report.server.port}`
      : 'Server: no server answering',
  );
  lines.push('');

  if (!report.database.ok) {
    lines.push(`Database: cannot open (${report.database.error})`);
  } else {
    lines.push('Database:');
    lines.push(`  Size: ${report.database.byteSize} bytes`);
    lines.push(`  Total events: ${report.database.totalEventCount}`);
    lines.push(
      `  Oldest event: ${report.database.oldestEventAt !== undefined ? formatEpochSeconds(report.database.oldestEventAt) : 'none'}`,
    );
    lines.push(
      `  Newest event: ${report.database.newestEventAt !== undefined ? formatEpochSeconds(report.database.newestEventAt) : 'none'}`,
    );
  }
  lines.push('');

  lines.push('Sites:');
  if (report.sites.length === 0) {
    lines.push('  (none configured)');
  } else {
    for (const site of report.sites) {
      const last = site.lastEventAt !== undefined ? formatEpochSeconds(site.lastEventAt) : 'never';
      lines.push(`  ${site.domain}: ${site.eventCount} events, last event ${last}`);
    }
  }
  lines.push('');

  lines.push(`Retention: ${report.retention.months} months`);
  if (report.retention.exceedsExemptionWindow) {
    lines.push(
      `  WARNING: exceeds the ${RETENTION_WARNING_THRESHOLD_MONTHS}-month window the EU audience-measurement ` +
        'consent exemption assumes.',
    );
  }
  lines.push('');

  lines.push('Scheduled jobs:');
  if (report.jobs === undefined) {
    lines.push('  unavailable — no server answered, so job state cannot be reported');
  } else if (report.jobs.length === 0) {
    lines.push('  (none reported)');
  } else {
    for (const job of report.jobs) {
      const parts: string[] = [];
      parts.push(job.hasRun ? `last run ${job.lastRunAt !== null ? formatEpochMillis(job.lastRunAt) : 'unknown'}` : 'never run');
      if (job.lastRunFailed) parts.push('FAILED');
      if (job.stale) parts.push('STALE');
      lines.push(`  ${job.name}: ${parts.join(', ')}`);
    }
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Command entry point
// ---------------------------------------------------------------------------

export interface RunStatusCommandOptions {
  readonly json: boolean;
  readonly loadConfigOptions?: LoadConfigOptions;
  /** Whether to check the npm registry for a newer published version. Defaults to `true`. */
  readonly checkForUpdates?: boolean;
}

/**
 * `tadoru status`: a single, read-only command answering "is Tadoru
 * working?" — whether a server is answering `/health`, whether the database
 * opens and what it holds, and each configured site's activity. Exits 0
 * only when a server answered *and* the database opened successfully, so it
 * doubles as a monitoring check; a stale job or retention past the
 * exemption window is reported, not treated as a failure on its own.
 *
 * Never reads `config.admin` or `config.session` — the report must never be
 * able to leak the admin password hash or the session secret.
 */
export async function runStatusCommand(options: RunStatusCommandOptions, ports: StatusPorts): Promise<number> {
  const loaded = ports.loadConfig(options.loadConfigOptions);
  if (!loaded.ok) {
    ports.log(loaded.error);
    return 1;
  }

  const report = await buildStatusReport(loaded.value.config, ports, options.checkForUpdates ?? true);

  ports.log(options.json ? JSON.stringify(report) : renderTextReport(report));

  return report.server.answering && report.database.ok ? 0 : 1;
}

import type { Database as BetterSqlite3Database } from 'better-sqlite3';

/**
 * The seven per-dimension daily rollup tables. Unique visitors are NOT
 * additive across dimensions, so each one is populated independently from
 * the raw `events` table rather than derived from another rollup table —
 * see SqliteRollupBuilder.
 */
export const ROLLUP_TABLE_NAMES = [
  'rollup_daily_path',
  'rollup_daily_referrer',
  'rollup_daily_country',
  'rollup_daily_device',
  'rollup_daily_browser',
  'rollup_daily_os',
  'rollup_daily_campaign',
] as const;

const ROLLUP_DIMENSION_COLUMN: Readonly<Record<string, string>> = {
  rollup_daily_path: 'path',
  rollup_daily_referrer: 'referrer',
  rollup_daily_country: 'country',
  rollup_daily_device: 'device',
  rollup_daily_browser: 'browser',
  rollup_daily_os: 'os',
  rollup_daily_campaign: 'campaign',
};

function rollupTableSql(tableName: string): string {
  const dimensionColumn = ROLLUP_DIMENSION_COLUMN[tableName];
  return `
    CREATE TABLE IF NOT EXISTS ${tableName} (
      day INTEGER NOT NULL,
      site_id INTEGER NOT NULL,
      ${dimensionColumn} TEXT NOT NULL,
      pageviews INTEGER NOT NULL,
      visitors INTEGER NOT NULL,
      sessions INTEGER NOT NULL,
      bounces INTEGER NOT NULL,
      engagement_seconds INTEGER NOT NULL,
      PRIMARY KEY (day, site_id, ${dimensionColumn})
    );
  `;
}

interface Migration {
  readonly version: number;
  readonly up: (db: BetterSqlite3Database) => void;
}

const migrations: readonly Migration[] = [
  {
    version: 1,
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS sites (
          id INTEGER PRIMARY KEY,
          domain TEXT UNIQUE NOT NULL,
          created_at INTEGER
        );

        CREATE TABLE IF NOT EXISTS events (
          id              INTEGER PRIMARY KEY,
          ts              INTEGER NOT NULL,
          site_id         INTEGER NOT NULL,
          visitor_id      BLOB    NOT NULL,
          session_id      BLOB    NOT NULL,
          type            TEXT    NOT NULL,
          path            TEXT    NOT NULL,
          referrer_source TEXT,
          utm_source TEXT, utm_medium TEXT, utm_campaign TEXT, utm_content TEXT, utm_term TEXT,
          country         TEXT,
          device_type TEXT, browser TEXT, os TEXT,
          lang TEXT, screen_bucket TEXT, color_scheme TEXT,
          name            TEXT,
          props           TEXT,
          value           REAL,
          FOREIGN KEY (site_id) REFERENCES sites(id)
        );
        CREATE INDEX IF NOT EXISTS idx_events_site_ts ON events(site_id, ts);
        CREATE INDEX IF NOT EXISTS idx_events_visitor ON events(visitor_id, ts);

        CREATE TABLE IF NOT EXISTS salt (
          id         INTEGER PRIMARY KEY CHECK (id = 1),
          value      TEXT    NOT NULL,
          rotated_at INTEGER NOT NULL
        );

        ${ROLLUP_TABLE_NAMES.map(rollupTableSql).join('\n')}
      `);
    },
  },
];

/**
 * Applies every migration that has not yet been recorded in
 * `schema_migrations`, inside a single transaction. Safe to call on every
 * startup: with nothing pending it is a no-op.
 */
export function applyMigrations(db: BetterSqlite3Database): void {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER)');

  const appliedVersions = new Set(
    (db.prepare('SELECT version FROM schema_migrations').all() as { version: number }[]).map((row) => row.version),
  );
  const pending = migrations.filter((migration) => !appliedVersions.has(migration.version));
  if (pending.length === 0) return;

  const insertVersion = db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)');
  const applyPending = db.transaction((toApply: readonly Migration[]) => {
    for (const migration of toApply) {
      migration.up(db);
      insertVersion.run(migration.version, Date.now());
    }
  });
  applyPending(pending);
}

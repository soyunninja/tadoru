import { test } from 'node:test';
import assert from 'node:assert/strict';
import DatabaseConstructor from 'better-sqlite3';
import type { Database as BetterSqlite3Database } from 'better-sqlite3';
import { applyMigrations, ROLLUP_TABLE_NAMES, AGGREGATE_TABLE_NAMES } from './index.ts';
import { ROLLUP_TABLE_ALLOW_LIST } from '../../../../domain/report/Breakdown.ts';

function tableNames(db: BetterSqlite3Database): string[] {
  return db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all()
    .map((row) => (row as { name: string }).name);
}

test('creates every expected table', () => {
  const db = new DatabaseConstructor(':memory:');
  applyMigrations(db);

  const names = tableNames(db);
  assert.ok(names.includes('schema_migrations'));
  assert.ok(names.includes('sites'));
  assert.ok(names.includes('events'));
  assert.ok(names.includes('salt'));
  for (const rollupTable of ROLLUP_TABLE_NAMES) {
    assert.ok(names.includes(rollupTable), `missing ${rollupTable}`);
  }
  for (const aggregateTable of AGGREGATE_TABLE_NAMES) {
    assert.ok(names.includes(aggregateTable), `missing ${aggregateTable}`);
  }
});

test('records every applied migration version in schema_migrations', () => {
  const db = new DatabaseConstructor(':memory:');
  applyMigrations(db);

  const rows = db.prepare('SELECT version FROM schema_migrations ORDER BY version').all() as { version: number }[];
  assert.ok(rows.length > 0);
  assert.ok(rows.every((row) => typeof row.version === 'number'));
});

test('is idempotent: applying twice does not error or duplicate migration rows', () => {
  const db = new DatabaseConstructor(':memory:');
  applyMigrations(db);
  const firstRunCount = (db.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get() as { n: number }).n;

  applyMigrations(db);
  const secondRunCount = (db.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get() as { n: number }).n;

  assert.equal(secondRunCount, firstRunCount);
});

test('the salt table enforces a single row via its id check constraint', () => {
  const db = new DatabaseConstructor(':memory:');
  applyMigrations(db);

  db.prepare('INSERT INTO salt (id, value, rotated_at) VALUES (1, ?, ?)').run('salt-a', 1);
  assert.throws(() => {
    db.prepare('INSERT INTO salt (id, value, rotated_at) VALUES (2, ?, ?)').run('salt-b', 2);
  });
});

test('the sites table enforces unique domains', () => {
  const db = new DatabaseConstructor(':memory:');
  applyMigrations(db);

  db.prepare('INSERT INTO sites (domain, created_at) VALUES (?, ?)').run('example.com', 1);
  assert.throws(() => {
    db.prepare('INSERT INTO sites (domain, created_at) VALUES (?, ?)').run('example.com', 2);
  });
});

test('upgrades a database that only has migration 1 applied: the three new rollup tables appear without re-running migration 1', () => {
  const db = new DatabaseConstructor(':memory:');

  // Simulate a real installation that already ran migration 1 before the
  // new v2 migration existed: apply only the original seven-table schema
  // and record version 1 as applied, without going through the current
  // `migrations` array (which would also apply v2).
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER)');
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
    CREATE TABLE IF NOT EXISTS salt (
      id         INTEGER PRIMARY KEY CHECK (id = 1),
      value      TEXT    NOT NULL,
      rotated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS rollup_daily_path (
      day INTEGER NOT NULL, site_id INTEGER NOT NULL, path TEXT NOT NULL,
      pageviews INTEGER NOT NULL, visitors INTEGER NOT NULL, sessions INTEGER NOT NULL,
      bounces INTEGER NOT NULL, engagement_seconds INTEGER NOT NULL,
      PRIMARY KEY (day, site_id, path)
    );
    CREATE TABLE IF NOT EXISTS rollup_daily_referrer (
      day INTEGER NOT NULL, site_id INTEGER NOT NULL, referrer TEXT NOT NULL,
      pageviews INTEGER NOT NULL, visitors INTEGER NOT NULL, sessions INTEGER NOT NULL,
      bounces INTEGER NOT NULL, engagement_seconds INTEGER NOT NULL,
      PRIMARY KEY (day, site_id, referrer)
    );
    CREATE TABLE IF NOT EXISTS rollup_daily_country (
      day INTEGER NOT NULL, site_id INTEGER NOT NULL, country TEXT NOT NULL,
      pageviews INTEGER NOT NULL, visitors INTEGER NOT NULL, sessions INTEGER NOT NULL,
      bounces INTEGER NOT NULL, engagement_seconds INTEGER NOT NULL,
      PRIMARY KEY (day, site_id, country)
    );
    CREATE TABLE IF NOT EXISTS rollup_daily_device (
      day INTEGER NOT NULL, site_id INTEGER NOT NULL, device TEXT NOT NULL,
      pageviews INTEGER NOT NULL, visitors INTEGER NOT NULL, sessions INTEGER NOT NULL,
      bounces INTEGER NOT NULL, engagement_seconds INTEGER NOT NULL,
      PRIMARY KEY (day, site_id, device)
    );
    CREATE TABLE IF NOT EXISTS rollup_daily_browser (
      day INTEGER NOT NULL, site_id INTEGER NOT NULL, browser TEXT NOT NULL,
      pageviews INTEGER NOT NULL, visitors INTEGER NOT NULL, sessions INTEGER NOT NULL,
      bounces INTEGER NOT NULL, engagement_seconds INTEGER NOT NULL,
      PRIMARY KEY (day, site_id, browser)
    );
    CREATE TABLE IF NOT EXISTS rollup_daily_os (
      day INTEGER NOT NULL, site_id INTEGER NOT NULL, os TEXT NOT NULL,
      pageviews INTEGER NOT NULL, visitors INTEGER NOT NULL, sessions INTEGER NOT NULL,
      bounces INTEGER NOT NULL, engagement_seconds INTEGER NOT NULL,
      PRIMARY KEY (day, site_id, os)
    );
    CREATE TABLE IF NOT EXISTS rollup_daily_campaign (
      day INTEGER NOT NULL, site_id INTEGER NOT NULL, campaign TEXT NOT NULL,
      pageviews INTEGER NOT NULL, visitors INTEGER NOT NULL, sessions INTEGER NOT NULL,
      bounces INTEGER NOT NULL, engagement_seconds INTEGER NOT NULL,
      PRIMARY KEY (day, site_id, campaign)
    );
  `);
  db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (1, ?)').run(Date.now());

  const namesBefore = tableNames(db);
  assert.ok(!namesBefore.includes('rollup_daily_screen'), 'sanity check: v2 tables must not pre-exist');

  // The real upgrade path: an existing installation restarts, and
  // applyMigrations runs again against its already-migrated database.
  applyMigrations(db);

  const namesAfter = tableNames(db);
  assert.ok(namesAfter.includes('rollup_daily_screen'));
  assert.ok(namesAfter.includes('rollup_daily_language'));
  assert.ok(namesAfter.includes('rollup_daily_color_scheme'));

  const versions = (db.prepare('SELECT version FROM schema_migrations ORDER BY version').all() as { version: number }[]).map(
    (row) => row.version,
  );
  // Also picks up migration 3 (the scroll-depth rollup): applyMigrations
  // applies every pending migration, not just the next one.
  assert.deepEqual(versions, [1, 2, 3]);
});

test('each rollup table is keyed by (day, site_id, dimension) and rejects duplicates', () => {
  const db = new DatabaseConstructor(':memory:');
  applyMigrations(db);

  db.prepare(
    'INSERT INTO rollup_daily_path (day, site_id, path, pageviews, visitors, sessions, bounces, engagement_seconds) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(1, 1, '/blog', 1, 1, 1, 0, 0);

  assert.throws(() => {
    db.prepare(
      'INSERT INTO rollup_daily_path (day, site_id, path, pageviews, visitors, sessions, bounces, engagement_seconds) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(1, 1, '/blog', 2, 2, 2, 0, 0);
  });
});

// The migration list must stay a frozen literal — a shipped migration records
// which tables were created when, and deriving it would rewrite history. So it
// cannot be generated from the breakdown allow-list; the two are kept honest
// by this test instead. Without it, a dimension added to the allow-list but
// forgotten in a migration passes both `npm test` and `npm run typecheck`, and
// fails only at runtime, on a dashboard request, as `no such table`.
test('every breakdown dimension has a rollup table created by some migration, and no migration creates a table no dimension uses', () => {
  const created = [...ROLLUP_TABLE_NAMES].sort();
  const required = [...ROLLUP_TABLE_ALLOW_LIST].sort();
  assert.deepEqual(created, required);
});

// AGGREGATE_TABLE_NAMES holds additive, non-dimension aggregate tables (like
// the scroll-depth rollup): tables that must exist, but must NEVER be folded
// into ROLLUP_TABLE_NAMES/ROLLUP_TABLE_ALLOW_LIST, because that equality test
// above exists specifically to guarantee every BREAKDOWN_DIMENSIONS entry has
// exactly one rollup table and vice versa. Weakening that assertion into a
// subset check to make room for a non-dimension table would silently give up
// the guarantee it exists to provide, so the two lists are kept disjoint
// instead.
test('aggregate (non-dimension) tables are disjoint from the dimension rollup allow-list', () => {
  for (const aggregateTable of AGGREGATE_TABLE_NAMES) {
    assert.ok(
      !(ROLLUP_TABLE_NAMES as readonly string[]).includes(aggregateTable),
      `${aggregateTable} must not be a dimension rollup table`,
    );
    assert.ok(
      !ROLLUP_TABLE_ALLOW_LIST.includes(aggregateTable),
      `${aggregateTable} must not be in the breakdown-dimension allow-list`,
    );
  }
});

test('upgrades a database that has migrations 1 and 2 applied: the scroll-depth aggregate table appears without re-running earlier migrations, and existing rows survive', () => {
  const db = new DatabaseConstructor(':memory:');

  // Simulate a real installation that already ran migrations 1 and 2 before
  // migration 3 existed: build the exact schema those two migrations
  // produce and record both versions as applied, without going through the
  // current `migrations` array (which would also apply v3).
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER)');
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
    CREATE TABLE IF NOT EXISTS salt (
      id         INTEGER PRIMARY KEY CHECK (id = 1),
      value      TEXT    NOT NULL,
      rotated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS rollup_daily_path (
      day INTEGER NOT NULL, site_id INTEGER NOT NULL, path TEXT NOT NULL,
      pageviews INTEGER NOT NULL, visitors INTEGER NOT NULL, sessions INTEGER NOT NULL,
      bounces INTEGER NOT NULL, engagement_seconds INTEGER NOT NULL,
      PRIMARY KEY (day, site_id, path)
    );
    CREATE TABLE IF NOT EXISTS rollup_daily_referrer (
      day INTEGER NOT NULL, site_id INTEGER NOT NULL, referrer TEXT NOT NULL,
      pageviews INTEGER NOT NULL, visitors INTEGER NOT NULL, sessions INTEGER NOT NULL,
      bounces INTEGER NOT NULL, engagement_seconds INTEGER NOT NULL,
      PRIMARY KEY (day, site_id, referrer)
    );
    CREATE TABLE IF NOT EXISTS rollup_daily_country (
      day INTEGER NOT NULL, site_id INTEGER NOT NULL, country TEXT NOT NULL,
      pageviews INTEGER NOT NULL, visitors INTEGER NOT NULL, sessions INTEGER NOT NULL,
      bounces INTEGER NOT NULL, engagement_seconds INTEGER NOT NULL,
      PRIMARY KEY (day, site_id, country)
    );
    CREATE TABLE IF NOT EXISTS rollup_daily_device (
      day INTEGER NOT NULL, site_id INTEGER NOT NULL, device TEXT NOT NULL,
      pageviews INTEGER NOT NULL, visitors INTEGER NOT NULL, sessions INTEGER NOT NULL,
      bounces INTEGER NOT NULL, engagement_seconds INTEGER NOT NULL,
      PRIMARY KEY (day, site_id, device)
    );
    CREATE TABLE IF NOT EXISTS rollup_daily_browser (
      day INTEGER NOT NULL, site_id INTEGER NOT NULL, browser TEXT NOT NULL,
      pageviews INTEGER NOT NULL, visitors INTEGER NOT NULL, sessions INTEGER NOT NULL,
      bounces INTEGER NOT NULL, engagement_seconds INTEGER NOT NULL,
      PRIMARY KEY (day, site_id, browser)
    );
    CREATE TABLE IF NOT EXISTS rollup_daily_os (
      day INTEGER NOT NULL, site_id INTEGER NOT NULL, os TEXT NOT NULL,
      pageviews INTEGER NOT NULL, visitors INTEGER NOT NULL, sessions INTEGER NOT NULL,
      bounces INTEGER NOT NULL, engagement_seconds INTEGER NOT NULL,
      PRIMARY KEY (day, site_id, os)
    );
    CREATE TABLE IF NOT EXISTS rollup_daily_campaign (
      day INTEGER NOT NULL, site_id INTEGER NOT NULL, campaign TEXT NOT NULL,
      pageviews INTEGER NOT NULL, visitors INTEGER NOT NULL, sessions INTEGER NOT NULL,
      bounces INTEGER NOT NULL, engagement_seconds INTEGER NOT NULL,
      PRIMARY KEY (day, site_id, campaign)
    );
    CREATE TABLE IF NOT EXISTS rollup_daily_screen (
      day INTEGER NOT NULL, site_id INTEGER NOT NULL, screen TEXT NOT NULL,
      pageviews INTEGER NOT NULL, visitors INTEGER NOT NULL, sessions INTEGER NOT NULL,
      bounces INTEGER NOT NULL, engagement_seconds INTEGER NOT NULL,
      PRIMARY KEY (day, site_id, screen)
    );
    CREATE TABLE IF NOT EXISTS rollup_daily_language (
      day INTEGER NOT NULL, site_id INTEGER NOT NULL, language TEXT NOT NULL,
      pageviews INTEGER NOT NULL, visitors INTEGER NOT NULL, sessions INTEGER NOT NULL,
      bounces INTEGER NOT NULL, engagement_seconds INTEGER NOT NULL,
      PRIMARY KEY (day, site_id, language)
    );
    CREATE TABLE IF NOT EXISTS rollup_daily_color_scheme (
      day INTEGER NOT NULL, site_id INTEGER NOT NULL, color_scheme TEXT NOT NULL,
      pageviews INTEGER NOT NULL, visitors INTEGER NOT NULL, sessions INTEGER NOT NULL,
      bounces INTEGER NOT NULL, engagement_seconds INTEGER NOT NULL,
      PRIMARY KEY (day, site_id, color_scheme)
    );
  `);
  db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (1, ?)').run(Date.now());
  db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (2, ?)').run(Date.now());
  db
    .prepare(
      'INSERT INTO rollup_daily_screen (day, site_id, screen, pageviews, visitors, sessions, bounces, engagement_seconds) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    )
    .run(1, 1, 'md', 3, 2, 2, 0, 60);

  const namesBefore = tableNames(db);
  assert.ok(!namesBefore.includes('rollup_daily_scroll'), 'sanity check: v3 table must not pre-exist');

  // The real upgrade path: an existing installation on 0.6.1 (migrations 1
  // and 2 already applied) restarts on the new version, and applyMigrations
  // runs again against its already-migrated database.
  applyMigrations(db);

  const namesAfter = tableNames(db);
  assert.ok(namesAfter.includes('rollup_daily_scroll'));

  const preExistingRow = db.prepare('SELECT * FROM rollup_daily_screen WHERE day = 1 AND site_id = 1').get() as
    | { screen: string; pageviews: number }
    | undefined;
  assert.deepEqual(preExistingRow && { screen: preExistingRow.screen, pageviews: preExistingRow.pageviews }, {
    screen: 'md',
    pageviews: 3,
  });

  const versions = (
    db.prepare('SELECT version FROM schema_migrations ORDER BY version').all() as { version: number }[]
  ).map((row) => row.version);
  assert.deepEqual(versions, [1, 2, 3]);
});

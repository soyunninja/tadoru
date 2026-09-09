# 0002 — SQLite with per-dimension rollup tables

Status: accepted

## Context

Analytics is an OLAP workload, which normally argues for a columnar store. But this software is
distributed for other people to run on their own VPS, so the operational cost of the database
falls on them.

The reference points are concrete. Self-hosted Plausible runs PostgreSQL for metadata and
ClickHouse for events: four services in its compose file and 2–4 GB of RAM for ClickHouse alone.
Umami runs one Node process plus PostgreSQL in around 512 MB.

## Decision

SQLite via `better-sqlite3` in WAL mode, with one rollup table per reporting dimension.

Queries read from rollups for closed days and from raw events for today, then combine.

## Consequences

- Installation has no database service at all: one process, one file. Backup is
  `VACUUM INTO` a dated file; restore is copying it back.
- The synchronous API suits the batched-write ingest path, which flushes a buffer inside a single
  transaction.
- **Unique visitors are not additive, and this is the trap the whole design has to avoid.** A
  single rollup table with all dimensions crossed cannot have its `visitors` column summed when
  aggregating by another dimension: the result is inflated. Therefore each dimension gets its own
  table and its own exact `COUNT(DISTINCT visitor_id)` computed independently from raw events. A
  test seeds one visitor viewing two paths from one country and asserts the path rollup sums to 2
  while the country rollup sums to 1.
- Ad-hoc queries scanning millions of raw rows will be slow. Reporting must go through rollups.
- The ports keep this reversible: moving to ClickHouse later means replacing two adapters, not
  rewriting the domain.

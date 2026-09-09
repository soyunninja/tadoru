import type { Database as BetterSqlite3Database, Statement } from 'better-sqlite3';
import type { EventRepository } from '../../../domain/ports/EventRepository.ts';
import type { TrackedEvent } from '../../../domain/event/TrackedEvent.ts';
import { createTrackedEvent } from '../../../domain/event/TrackedEvent.ts';
import type { SiteId } from '../../../domain/event/SiteId.ts';
import { createGeoCountry } from '../../../domain/event/GeoCountry.ts';
import { isDeviceType } from '../../../domain/event/DeviceProfile.ts';
import type { DeviceType } from '../../../domain/event/DeviceProfile.ts';
import type { ScreenBucket } from '../../../domain/event/ScreenBucket.ts';
import { SqliteSiteRegistry } from './SqliteSiteRegistry.ts';

interface EventRow {
  readonly ts: number;
  readonly site_domain: string;
  readonly visitor_id: Uint8Array;
  readonly session_id: Uint8Array;
  readonly type: string;
  readonly path: string;
  readonly referrer_source: string | null;
  readonly utm_source: string | null;
  readonly utm_medium: string | null;
  readonly utm_campaign: string | null;
  readonly utm_content: string | null;
  readonly utm_term: string | null;
  readonly country: string | null;
  readonly device_type: string | null;
  readonly browser: string | null;
  readonly os: string | null;
  readonly lang: string | null;
  readonly screen_bucket: string | null;
  readonly color_scheme: string | null;
  readonly name: string | null;
  readonly props: string | null;
  readonly value: number | null;
}

function toDeviceType(raw: string | null): DeviceType {
  return raw !== null && isDeviceType(raw) ? raw : 'unknown';
}

function mapRowToTrackedEvent(row: EventRow): TrackedEvent {
  return createTrackedEvent({
    ts: row.ts,
    siteId: row.site_domain as SiteId,
    visitorId: row.visitor_id,
    sessionId: row.session_id,
    type: row.type as TrackedEvent['type'],
    path: row.path,
    country: createGeoCountry(row.country),
    deviceType: toDeviceType(row.device_type),
    browserFamily: row.browser ?? '',
    osFamily: row.os ?? '',
    ...(row.referrer_source !== null ? { referrerSource: row.referrer_source } : {}),
    ...(row.utm_source !== null ? { utmSource: row.utm_source } : {}),
    ...(row.utm_medium !== null ? { utmMedium: row.utm_medium } : {}),
    ...(row.utm_campaign !== null ? { utmCampaign: row.utm_campaign } : {}),
    ...(row.utm_content !== null ? { utmContent: row.utm_content } : {}),
    ...(row.utm_term !== null ? { utmTerm: row.utm_term } : {}),
    ...(row.lang !== null ? { lang: row.lang } : {}),
    ...(row.screen_bucket !== null ? { screenBucket: row.screen_bucket as ScreenBucket } : {}),
    ...(row.color_scheme !== null ? { colorScheme: row.color_scheme } : {}),
    ...(row.name !== null ? { name: row.name } : {}),
    ...(row.props !== null ? { props: JSON.parse(row.props) as Record<string, unknown> } : {}),
    ...(row.value !== null ? { value: row.value } : {}),
  });
}

/**
 * SQLite adapter for the EventRepository port. Writes go through a single
 * prepared statement inside one transaction per batch; reads back join
 * against `sites` to recover the domain string the domain layer expects.
 */
export class SqliteEventRepository implements EventRepository {
  readonly #db: BetterSqlite3Database;
  readonly #siteRegistry: SqliteSiteRegistry;
  readonly #insert: Statement<unknown[]>;
  readonly #selectLastForVisitor: Statement<[Buffer], EventRow>;
  readonly #deleteOlderThan: Statement<[number]>;

  constructor(db: BetterSqlite3Database) {
    this.#db = db;
    this.#siteRegistry = new SqliteSiteRegistry(db);

    this.#insert = db.prepare(`
      INSERT INTO events (
        ts, site_id, visitor_id, session_id, type, path,
        referrer_source, utm_source, utm_medium, utm_campaign, utm_content, utm_term,
        country, device_type, browser, os,
        lang, screen_bucket, color_scheme,
        name, props, value
      ) VALUES (
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?
      )
    `);

    this.#selectLastForVisitor = db.prepare(`
      SELECT e.ts, s.domain AS site_domain, e.visitor_id, e.session_id, e.type, e.path,
             e.referrer_source, e.utm_source, e.utm_medium, e.utm_campaign, e.utm_content, e.utm_term,
             e.country, e.device_type, e.browser, e.os,
             e.lang, e.screen_bucket, e.color_scheme,
             e.name, e.props, e.value
      FROM events e
      JOIN sites s ON s.id = e.site_id
      WHERE e.visitor_id = ?
      ORDER BY e.ts DESC
      LIMIT 1
    `);

    this.#deleteOlderThan = db.prepare('DELETE FROM events WHERE ts < ?');
  }

  saveBatch(events: readonly TrackedEvent[]): Promise<void> {
    const insertAll = this.#db.transaction((batch: readonly TrackedEvent[]) => {
      for (const event of batch) {
        const siteRowId = this.#siteRegistry.idFor(event.siteId);
        this.#insert.run(
          event.ts,
          siteRowId,
          Buffer.from(event.visitorId),
          Buffer.from(event.sessionId),
          event.type,
          event.path,
          event.referrerSource ?? null,
          event.utmSource ?? null,
          event.utmMedium ?? null,
          event.utmCampaign ?? null,
          event.utmContent ?? null,
          event.utmTerm ?? null,
          event.country,
          event.deviceType,
          event.browserFamily,
          event.osFamily,
          event.lang ?? null,
          event.screenBucket ?? null,
          event.colorScheme ?? null,
          event.name ?? null,
          event.props !== undefined ? JSON.stringify(event.props) : null,
          event.value ?? null,
        );
      }
    });

    insertAll(events);
    return Promise.resolve();
  }

  findLastEventForVisitor(visitorId: Uint8Array): Promise<TrackedEvent | undefined> {
    const row = this.#selectLastForVisitor.get(Buffer.from(visitorId));
    return Promise.resolve(row === undefined ? undefined : mapRowToTrackedEvent(row));
  }

  /**
   * Deletes raw events older than the retention cutoff (strictly before
   * `cutoffTs`), returning the number of rows removed. Used by
   * PurgeExpiredData; rollups are never purged.
   */
  deleteOlderThan(cutoffTs: number): Promise<number> {
    const result = this.#deleteOlderThan.run(cutoffTs);
    return Promise.resolve(result.changes);
  }
}

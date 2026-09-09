import type { Result } from '../../../shared/Result.ts';
import { ok, err } from '../../../shared/Result.ts';

/**
 * The fixed set of dimensions a report can be broken down by. This is a
 * closed allow-list on purpose: it is the only thing standing between a
 * dimension string and a SQL table/column name, so an arbitrary value must
 * never be able to reach the query layer.
 */
export const BREAKDOWN_DIMENSIONS = [
  'path',
  'referrer',
  'country',
  'device',
  'browser',
  'os',
  'campaign',
] as const;

export type BreakdownDimension = (typeof BREAKDOWN_DIMENSIONS)[number];

export function isBreakdownDimension(value: string): value is BreakdownDimension {
  return (BREAKDOWN_DIMENSIONS as readonly string[]).includes(value);
}

const ROLLUP_TABLE_BY_DIMENSION: Readonly<Record<BreakdownDimension, string>> = {
  path: 'rollup_daily_path',
  referrer: 'rollup_daily_referrer',
  country: 'rollup_daily_country',
  device: 'rollup_daily_device',
  browser: 'rollup_daily_browser',
  os: 'rollup_daily_os',
  campaign: 'rollup_daily_campaign',
};

const RAW_COLUMN_BY_DIMENSION: Readonly<Record<BreakdownDimension, string>> = {
  path: 'path',
  referrer: 'referrer_source',
  country: 'country',
  device: 'device_type',
  browser: 'browser',
  os: 'os',
  campaign: 'utm_campaign',
};

/** Every rollup table name that a Breakdown can ever resolve to. */
export const ROLLUP_TABLE_ALLOW_LIST: readonly string[] = Object.values(ROLLUP_TABLE_BY_DIMENSION);

export interface Breakdown {
  readonly dimension: BreakdownDimension;
  readonly rollupTable: string;
  readonly rawColumn: string;
}

export function createBreakdown(raw: string): Result<Breakdown, string> {
  if (!isBreakdownDimension(raw)) {
    return err(`Breakdown: unsupported dimension "${raw}"`);
  }
  return ok({
    dimension: raw,
    rollupTable: ROLLUP_TABLE_BY_DIMENSION[raw],
    rawColumn: RAW_COLUMN_BY_DIMENSION[raw],
  });
}

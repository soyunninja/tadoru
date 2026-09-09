/**
 * Maps an exact pixel width to a coarse breakpoint bucket and discards the
 * exact value. This is an anti-fingerprinting control: the exact width must
 * never be recoverable from the stored bucket.
 */
export const SCREEN_BUCKETS = ['xs', 'sm', 'md', 'lg', 'xl', '2xl'] as const;

export type ScreenBucket = (typeof SCREEN_BUCKETS)[number];

export function bucketScreenWidth(width: number): ScreenBucket {
  if (width < 640) return 'xs';
  if (width < 768) return 'sm';
  if (width < 1024) return 'md';
  if (width < 1280) return 'lg';
  if (width < 1536) return 'xl';
  return '2xl';
}

/**
 * How far past a job's own configured interval it may go, with no
 * successful run, before it is reported as stale rather than merely
 * quiet. Ordinary jitter — a slow batch, a GC pause, a timer firing a
 * little late under load — should not read as an outage, so the bar is
 * set above the interval itself; going twice as long as configured with
 * no success is a real problem, not noise.
 */
export const STALE_INTERVAL_MULTIPLIER = 2;

export interface JobStalenessInput {
  readonly intervalMs: number;
  /** Epoch ms of the last run that actually succeeded, or undefined if none has. */
  readonly lastRunAt: number | undefined;
}

/**
 * Judges one job's staleness against `now`. A job that has never run at
 * all is judged against how long the scheduler has actually been up
 * (`schedulerStartedAt`), never against epoch zero — otherwise every job
 * would report instantly stale on a fresh boot, before it has even had a
 * chance to run once.
 */
export function isJobStale(
  job: JobStalenessInput,
  now: number,
  schedulerStartedAt: number | undefined,
): boolean {
  // Purely a question of elapsed time since the last success. Whether a run has
  // been *attempted* deliberately plays no part: the scheduler marks a job as
  // started before awaiting it, so "attempted, no success yet" is the shape of
  // a healthy first run in flight as well as of a failed one. Judging on that
  // reported a working job as an outage. A run that failed is surfaced on its
  // own field, and if failures keep happening this clock runs out anyway.
  const reference = job.lastRunAt ?? schedulerStartedAt;
  if (reference === undefined) return false;

  return now - reference > STALE_INTERVAL_MULTIPLIER * job.intervalMs;
}

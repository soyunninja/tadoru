export interface SchedulerJob {
  readonly name: string;
  readonly intervalMs: number;
  run(): Promise<void>;
}

export interface TimerHandle {
  cancel(): void;
}

/** Injected timer port so tests can advance virtual time instead of sleeping. */
export interface TimerPort {
  schedule(fn: () => void, delayMs: number): TimerHandle;
}

export interface SchedulerClock {
  now(): Date;
}

export interface SchedulerDependencies {
  readonly jobs: readonly SchedulerJob[];
  readonly timers?: TimerPort;
  readonly clock?: SchedulerClock;
}

const realTimers: TimerPort = {
  schedule(fn, delayMs) {
    const timer = setTimeout(fn, delayMs);
    // Never keep the process alive on account of a scheduled job alone —
    // that is what makes `stop()` clean for SIGTERM.
    timer.unref?.();
    return { cancel: () => clearTimeout(timer) };
  },
};

/**
 * Runs recurring in-process jobs (salt rotation, nightly rollups, retention
 * purge) on their own intervals, so the product needs no external crontab.
 * Each job reschedules itself only after it settles, so a slow or failing
 * run never causes overlapping executions of the same job.
 */
export class Scheduler {
  readonly #jobs: readonly SchedulerJob[];
  readonly #timers: TimerPort;
  readonly #clock: SchedulerClock;
  readonly #lastRunAt = new Map<string, number>();
  readonly #handles = new Map<string, TimerHandle>();
  #running = false;

  constructor(dependencies: SchedulerDependencies) {
    this.#jobs = dependencies.jobs;
    this.#timers = dependencies.timers ?? realTimers;
    this.#clock = dependencies.clock ?? { now: () => new Date() };
  }

  start(): void {
    if (this.#running) return;
    this.#running = true;
    for (const job of this.#jobs) {
      this.#scheduleNext(job);
    }
  }

  /** Cancels every pending timer. Safe to call more than once, and clean enough to run from a SIGTERM handler. */
  stop(): void {
    this.#running = false;
    for (const handle of this.#handles.values()) {
      handle.cancel();
    }
    this.#handles.clear();
  }

  /** Epoch-millisecond timestamp of each job's last successful run, or `undefined` if it has never run. Backs `/health`. */
  getLastRunTimes(): Readonly<Record<string, number | undefined>> {
    const result: Record<string, number | undefined> = {};
    for (const job of this.#jobs) {
      result[job.name] = this.#lastRunAt.get(job.name);
    }
    return result;
  }

  #scheduleNext(job: SchedulerJob): void {
    const handle = this.#timers.schedule(() => {
      void this.#runJob(job);
    }, job.intervalMs);
    this.#handles.set(job.name, handle);
  }

  async #runJob(job: SchedulerJob): Promise<void> {
    try {
      await job.run();
      this.#lastRunAt.set(job.name, this.#clock.now().getTime());
    } catch {
      // One job failing must never crash the process or stop the others;
      // it simply tries again on its next scheduled run.
    } finally {
      if (this.#running) {
        this.#scheduleNext(job);
      }
    }
  }
}

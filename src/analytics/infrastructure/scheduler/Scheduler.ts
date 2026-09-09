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

/** Per-job health snapshot returned by {@link Scheduler.getJobStatuses}. Backs `/health`. */
export interface JobStatus {
  readonly name: string;
  readonly intervalMs: number;
  /** Epoch-millisecond timestamp of the job's last *successful* completion, or `undefined` if it has never succeeded. */
  readonly lastRunAt: number | undefined;
  /** Whether the job has been attempted at least once (success or failure), regardless of outcome. */
  readonly hasRun: boolean;
  /** Whether the job's most recent attempt threw. `false` if it has never run or its last attempt succeeded. */
  readonly lastRunFailed: boolean;
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
  readonly #hasRun = new Set<string>();
  readonly #lastRunFailed = new Map<string, boolean>();
  readonly #handles = new Map<string, TimerHandle>();
  #running = false;
  #startedAt: number | undefined;

  constructor(dependencies: SchedulerDependencies) {
    this.#jobs = dependencies.jobs;
    this.#timers = dependencies.timers ?? realTimers;
    this.#clock = dependencies.clock ?? { now: () => new Date() };
  }

  start(): void {
    if (this.#running) return;
    this.#running = true;
    this.#startedAt = this.#clock.now().getTime();
    for (const job of this.#jobs) {
      this.#scheduleNext(job);
    }
  }

  /** Epoch-millisecond timestamp of the most recent `start()` call, or `undefined` if it has never been started. */
  getStartedAt(): number | undefined {
    return this.#startedAt;
  }

  /** Cancels every pending timer. Safe to call more than once, and clean enough to run from a SIGTERM handler. */
  stop(): void {
    this.#running = false;
    for (const handle of this.#handles.values()) {
      handle.cancel();
    }
    this.#handles.clear();
  }

  /** One status snapshot per configured job, in job order. Backs `/health`. */
  getJobStatuses(): readonly JobStatus[] {
    return this.#jobs.map((job) => ({
      name: job.name,
      intervalMs: job.intervalMs,
      lastRunAt: this.#lastRunAt.get(job.name),
      hasRun: this.#hasRun.has(job.name),
      lastRunFailed: this.#lastRunFailed.get(job.name) ?? false,
    }));
  }

  #scheduleNext(job: SchedulerJob): void {
    const handle = this.#timers.schedule(() => {
      void this.#runJob(job);
    }, job.intervalMs);
    this.#handles.set(job.name, handle);
  }

  async #runJob(job: SchedulerJob): Promise<void> {
    this.#hasRun.add(job.name);
    try {
      await job.run();
      // A prior successful timestamp is left untouched by a later failure —
      // recorded here, not before the call, so a throw never overwrites it.
      this.#lastRunAt.set(job.name, this.#clock.now().getTime());
      this.#lastRunFailed.set(job.name, false);
    } catch {
      // One job failing must never crash the process or stop the others;
      // it simply tries again on its next scheduled run. The failure is
      // still recorded so `/health` can report it honestly.
      this.#lastRunFailed.set(job.name, true);
    } finally {
      if (this.#running) {
        this.#scheduleNext(job);
      }
    }
  }
}

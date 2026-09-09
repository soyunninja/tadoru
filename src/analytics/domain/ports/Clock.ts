/**
 * Driven port for the current time. Injected so use cases stay deterministic
 * under test.
 */
export interface Clock {
  now(): Date;
}

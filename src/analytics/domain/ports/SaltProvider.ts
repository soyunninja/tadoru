/**
 * Driven port for the current daily-rotating salt used to derive visitor
 * ids. Only the current salt is ever exposed; the previous day's salt is
 * destroyed, which is what prevents cross-day correlation.
 */
export interface SaltProvider {
  current(): Promise<string>;
}

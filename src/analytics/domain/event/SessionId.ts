import { randomBytes } from 'node:crypto';

/**
 * A random session id, plus the pure inactivity-window rule that decides
 * whether two events belong to the same session.
 */

const SESSION_ID_LENGTH = 16;
export const SESSION_INACTIVITY_WINDOW_MS = 30 * 60 * 1000;

export function generateSessionId(): Buffer {
  return randomBytes(SESSION_ID_LENGTH);
}

/**
 * A gap up to and including the inactivity window keeps the same session;
 * anything past it starts a new one.
 */
export function belongsToSameSession(lastSeenAt: Date, now: Date): boolean {
  const gapMs = now.getTime() - lastSeenAt.getTime();
  return gapMs <= SESSION_INACTIVITY_WINDOW_MS;
}

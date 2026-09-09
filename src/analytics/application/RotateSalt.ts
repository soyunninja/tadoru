import { randomBytes } from 'node:crypto';

/**
 * Driven capability for overwriting the current salt. Deliberately narrower
 * than the read-only `SaltProvider` domain port: only the salt adapter needs
 * to be able to write, and only this cron use case needs to ask it to.
 */
export interface SaltRotator {
  rotate(newSalt: string): Promise<void>;
}

const SALT_BYTE_LENGTH = 32;

export interface RotateSaltDependencies {
  readonly saltRotator: SaltRotator;
}

/**
 * Nightly (24h) cron use case: generates a fresh random salt and overwrites
 * the stored one. Only the current salt is ever persisted — the previous
 * value becomes unrecoverable, which is what prevents correlating a visitor
 * across days.
 */
export class RotateSalt {
  readonly #saltRotator: SaltRotator;

  constructor(dependencies: RotateSaltDependencies) {
    this.#saltRotator = dependencies.saltRotator;
  }

  async execute(): Promise<string> {
    const newSalt = randomBytes(SALT_BYTE_LENGTH).toString('hex');
    await this.#saltRotator.rotate(newSalt);
    return newSalt;
  }
}

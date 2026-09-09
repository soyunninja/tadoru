import type { SaltProvider } from '../SaltProvider.ts';

/**
 * In-memory SaltProvider fake. The salt can be rotated by the test to prove
 * that visitor ids change accordingly.
 */
export class FakeSaltProvider implements SaltProvider {
  #salt: string;

  constructor(initialSalt: string) {
    this.#salt = initialSalt;
  }

  current(): Promise<string> {
    return Promise.resolve(this.#salt);
  }

  rotate(nextSalt: string): void {
    this.#salt = nextSalt;
  }
}

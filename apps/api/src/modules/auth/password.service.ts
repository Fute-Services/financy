import { Injectable } from '@nestjs/common';
import argon2 from 'argon2';

/**
 * OWASP's 2024 baseline for argon2id (docs/12 §3.1).
 *
 * These are deliberately not tuned down for developer convenience. A hash that
 * verifies in a millisecond on a laptop verifies in a millisecond on an
 * attacker's GPU farm too, and the whole value of a slow KDF is that the
 * attacker pays the same cost we do — several million times over.
 */
const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19_456, // KiB
  timeCost: 2,
  parallelism: 1,
} as const;

/**
 * Verified against a hash of the same shape when no user exists.
 *
 * Without it, "no such account" returns in microseconds and "wrong password"
 * returns in ~50ms, and that difference enumerates every registered address in
 * the system with a stopwatch. Generated once at module load so the cost is
 * paid at startup rather than on the first failed login.
 */
const DUMMY_HASH_PROMISE = argon2.hash('financy-timing-equaliser', ARGON2_OPTIONS);

@Injectable()
export class PasswordService {
  async hash(plaintext: string): Promise<string> {
    return argon2.hash(plaintext, ARGON2_OPTIONS);
  }

  /**
   * Verify a password against a stored hash.
   *
   * Returns `false` rather than throwing on a malformed hash: a corrupted row
   * is a failed login, not a 500 that tells the caller something interesting
   * about the account.
   */
  async verify(hash: string, plaintext: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, plaintext);
    } catch {
      return false;
    }
  }

  /**
   * Burn the same time a real verification would, for an account that does not
   * exist. The result is discarded; only the elapsed time matters.
   */
  async verifyDummy(plaintext: string): Promise<false> {
    try {
      await argon2.verify(await DUMMY_HASH_PROMISE, plaintext);
    } catch {
      /* expected — the point is the work, not the answer */
    }
    return false;
  }

  /**
   * Whether the stored hash was produced with parameters we no longer use.
   *
   * Cost parameters are raised as hardware improves, and a user who never
   * changes their password would otherwise keep a hash from 2026 forever. The
   * rehash happens transparently on their next successful login, which is the
   * only moment the plaintext is available.
   */
  needsRehash(hash: string): boolean {
    try {
      return argon2.needsRehash(hash, ARGON2_OPTIONS);
    } catch {
      // Unparseable, so it certainly is not current.
      return true;
    }
  }
}

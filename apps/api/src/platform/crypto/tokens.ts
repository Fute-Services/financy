import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Opaque token handling.
 *
 * Lives in the platform rather than in `modules/auth` because both the auth
 * module and the guard need it, and the guard is platform — putting it in the
 * module would make the platform depend on a module, which is the dependency
 * this architecture does not allow (docs/08 §4.2).
 */

/** 256 bits: session tokens, invitation tokens, password-reset tokens. */
const TOKEN_BYTES = 32;

export function generateToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

/**
 * Hash a token for storage.
 *
 * SHA-256 rather than argon2, and that is not an oversight. A token is 256
 * bits of CSPRNG output, so there is no dictionary to attack and no work
 * factor worth paying; passwords are low-entropy and human-chosen, which is
 * the only reason they need a slow KDF.
 *
 * What matters is that the **digest** is what the database holds, so a
 * disclosure hands the reader no working sessions.
 */
export function hashToken(token: string): Uint8Array<ArrayBuffer> {
  const digest = createHash('sha256').update(token, 'utf8').digest();

  // Copied into a plain `ArrayBuffer` rather than returned as a `Buffer`.
  // Prisma types a `Bytes` column as `Uint8Array<ArrayBuffer>`; Node's
  // `Buffer` is `Uint8Array<ArrayBufferLike>`, which may be backed by a
  // `SharedArrayBuffer` and is therefore not assignable to it. Sixteen bytes
  // of copying, once per request.
  const bytes = new Uint8Array(new ArrayBuffer(digest.byteLength));
  bytes.set(digest);

  return bytes;
}

/** Constant-time comparison, for wherever two digests meet in memory. */
export function tokensMatch(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && timingSafeEqual(left, right);
}

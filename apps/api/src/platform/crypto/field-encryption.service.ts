import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import { ConfigService } from '../config/index.js';

/** AES-256-GCM: authenticated, so a tampered ciphertext fails rather than decodes. */
const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const TAG_BYTES = 16;

/**
 * The version marker on every ciphertext.
 *
 * Present from the first record so that rotating a key later is a migration
 * with a discriminator rather than an archaeology exercise. A store of
 * unmarked ciphertexts cannot be rotated incrementally: nothing can tell which
 * key any given row was written with.
 */
const VERSION = 'v1';

/**
 * Field-level encryption for the few columns that need it (docs/12 §5).
 *
 * ## What this is for, and what it is not
 *
 * It protects a **specific, small set of fields** — today, a supplier's bank
 * details — against the case where somebody can read the database and not the
 * application's key: a leaked backup, a read replica, a misconfigured
 * snapshot, a support engineer with a query console. It is not a substitute
 * for access control, and it does nothing at all against an attacker who has
 * the running process.
 *
 * That narrowness is the point. Encrypting everything makes every query a
 * decryption, every index useless, and the key a single point of total
 * failure; encrypting the fields whose disclosure is *itself* the harm keeps
 * the blast radius small and the cost near zero.
 *
 * ## The key is derived, not used raw
 *
 * `ENCRYPTION_KEY` is a passphrase of unknown entropy distribution, and
 * AES-256 needs exactly 32 bytes. SHA-256 over the configured value gives a
 * uniform key of the right length from whatever was supplied, and the config
 * schema already refuses a short or shared secret.
 *
 * ## The IV is random per record and stored with it
 *
 * GCM is catastrophic under IV reuse — two records encrypted with the same key
 * and IV leak their XOR. A random 96-bit IV per write, stored in front of the
 * ciphertext, is the standard construction and the only safe one here.
 */
@Injectable()
export class CryptoService {
  private readonly key: Buffer;

  constructor(config: ConfigService) {
    this.key = createHash('sha256').update(config.get('ENCRYPTION_KEY')).digest();
  }

  /**
   * Encrypt one field.
   *
   * Returns `v1:<iv>:<tag>:<ciphertext>`, base64url throughout, so the whole
   * thing is a plain string that survives a JSON column, a CSV of a backup, and
   * a copy-paste into a support ticket without being mangled.
   */
  encrypt(plaintext: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);

    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();

    return [
      VERSION,
      iv.toString('base64url'),
      tag.toString('base64url'),
      ciphertext.toString('base64url'),
    ].join(':');
  }

  /**
   * Decrypt one field.
   *
   * Throws on anything it does not recognise or cannot authenticate. That is
   * deliberate: a decrypt that returned `null` on a tampered value would let a
   * caller treat "somebody modified this row" as "this supplier has no bank
   * details", which is the same shape as a successful attack.
   */
  decrypt(encoded: string): string {
    const parts = encoded.split(':');

    if (parts.length !== 4 || parts[0] !== VERSION) {
      throw new Error('That value was not written by this encryption scheme.');
    }

    const [, iv, tag, ciphertext] = parts;

    const decipher = createDecipheriv(
      ALGORITHM,
      this.key,
      Buffer.from(iv ?? '', 'base64url'),
    );

    const authTag = Buffer.from(tag ?? '', 'base64url');

    if (authTag.length !== TAG_BYTES) {
      throw new Error('That ciphertext has no usable authentication tag.');
    }

    decipher.setAuthTag(authTag);

    return Buffer.concat([
      decipher.update(Buffer.from(ciphertext ?? '', 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  }
}

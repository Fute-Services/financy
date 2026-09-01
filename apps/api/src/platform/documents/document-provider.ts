export const DOCUMENT_PROVIDER = Symbol('DocumentProvider');

export interface SignedUrl {
  readonly url: string;
  readonly expiresAt: Date;
}

export interface ObjectMetadata {
  readonly byteSize: number;
  readonly contentType: string;
  readonly checksum: string;
}

/**
 * Private object storage with expiring links (docs/13 §7, ADR-0008).
 *
 * ## Four invariants, and they hold for every adapter
 *
 * - **Nothing is publicly readable.** Not "hard to guess" — unreadable without
 *   a signature that this system issued moments ago.
 * - **Keys are generated, never derived from a file name.** A key built from
 *   what somebody typed is a path traversal waiting to be written, and it also
 *   leaks: `receipts/dana-therapy-invoice.pdf` says something the person did
 *   not mean to say.
 * - **A download URL is issued only after an authorisation check on the owning
 *   record**, with a short TTL. A URL that outlives its check outlives the
 *   permission it was based on.
 * - **`Content-Disposition: attachment`**, so a stored file cannot be rendered
 *   as a page in this application's origin.
 *
 * The local adapter emulates the *security semantics* and not merely the
 * storage — expiry, signature, and the authorisation re-check — so that code
 * which works on a laptop is code that is safe against S3.
 */
export interface DocumentProvider {
  readonly providerKey: string;
  readonly isSandbox: boolean;

  /** Somewhere to PUT bytes, valid briefly and for one object only. */
  createUploadUrl(
    key: string,
    contentType: string,
    maxBytes: number,
    ttlSeconds: number,
  ): Promise<SignedUrl>;

  createDownloadUrl(key: string, ttlSeconds: number, fileName: string): Promise<SignedUrl>;

  /**
   * What is actually stored: size, type, and a checksum.
   *
   * Read from the object rather than from the client's claims, because the
   * completion step's entire job is to disbelieve the client.
   */
  getObjectMetadata(key: string): Promise<ObjectMetadata | null>;

  /** The first bytes, for deciding what the file really is. */
  readHeader(key: string, byteCount: number): Promise<Uint8Array | null>;

  /** Replace the object's bytes — used to store a scrubbed image over the original. */
  replaceObject(key: string, data: Uint8Array): Promise<void>;

  read(key: string): Promise<Uint8Array | null>;

  deleteObject(key: string): Promise<void>;
}

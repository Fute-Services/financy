/**
 * What a file actually is, read from its own first bytes (FR-EXP-004).
 *
 * ## Why the declared type is worthless
 *
 * `Content-Type` is chosen by whoever uploaded the file, and a file name is a
 * string somebody typed. An executable renamed `receipt.pdf` and uploaded with
 * `Content-Type: application/pdf` is indistinguishable from a receipt by every
 * signal except the one this module reads. The test the requirement asks for
 * is exactly that case, and it is the reason this exists at all.
 *
 * ## Why it lives in `core`
 *
 * It is a pure function over bytes: no I/O, no storage, no framework. That
 * makes it exhaustively testable — every accepted format, every rejection, the
 * empty file, the truncated header — which matters more here than almost
 * anywhere else in the system, because this is the function standing between
 * an object store and whatever somebody chose to put in it.
 *
 * ## What it deliberately does not do
 *
 * It does not parse the file. Recognising a container is not validating its
 * contents, and this module makes no claim that a PDF is a *safe* PDF. What it
 * guarantees is narrower and worth having: the object is one of five formats
 * the product accepts, and it is not something else wearing their name.
 */

/** The formats a receipt may be, in the wire's own vocabulary. */
export type DetectedFileType =
  'application/pdf' | 'image/jpeg' | 'image/png' | 'image/heic' | 'image/webp';

interface Signature {
  readonly type: DetectedFileType;
  /** Byte offset the pattern starts at. */
  readonly offset: number;
  readonly bytes: readonly number[];
  /**
   * A second pattern at another offset, for containers whose first bytes are
   * shared. RIFF is WebP *and* WAV *and* AVI; only the second marker separates
   * them, and a check that stopped at `RIFF` would accept an audio file.
   */
  readonly also?: { readonly offset: number; readonly bytes: readonly number[] };
}

const ASCII = (text: string): number[] => [...text].map((character) => character.charCodeAt(0));

const SIGNATURES: readonly Signature[] = [
  // `%PDF-`. The version digits that follow are deliberately not checked: a
  // PDF 2.0 file is still a PDF, and a version allow-list would reject
  // documents that are perfectly valid for a reason nobody could act on.
  { type: 'application/pdf', offset: 0, bytes: ASCII('%PDF-') },

  // SOI plus the first marker byte. `FF D8` alone appears inside other
  // formats often enough to be worth the third byte.
  { type: 'image/jpeg', offset: 0, bytes: [0xff, 0xd8, 0xff] },

  // The full eight-byte PNG signature, including the CRLF/EOF trap bytes that
  // exist to catch a file mangled by an FTP client in text mode.
  { type: 'image/png', offset: 0, bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },

  {
    type: 'image/webp',
    offset: 0,
    bytes: ASCII('RIFF'),
    also: { offset: 8, bytes: ASCII('WEBP') },
  },
];

/**
 * The ISO base-media brands that mean "this is a HEIC photograph".
 *
 * HEIC is an ISOBMFF container, like MP4 — the box header is identical and
 * only the brand distinguishes them. Accepting `ftyp` alone would accept a
 * video file, so the brand is checked and the list is closed.
 */
const HEIC_BRANDS = ['heic', 'heix', 'heim', 'heis', 'hevc', 'hevx', 'mif1', 'msf1'];

/** How many bytes are needed to decide. Everything above fits inside this. */
export const FILE_TYPE_HEADER_BYTES = 32;

/**
 * The file's real type, or `null` if it is not one this product accepts.
 *
 * `null` covers both "we recognised it and it is not allowed" and "we do not
 * recognise it at all", because the two produce the same answer to the caller
 * and distinguishing them in a message would tell an attacker which of their
 * attempts got closer.
 */
export function detectFileType(header: Uint8Array): DetectedFileType | null {
  for (const signature of SIGNATURES) {
    if (!matches(header, signature.offset, signature.bytes)) continue;
    if (
      signature.also !== undefined &&
      !matches(header, signature.also.offset, signature.also.bytes)
    ) {
      continue;
    }

    return signature.type;
  }

  // `....ftyp<brand>`: four bytes of box length, then the tag, then the brand.
  if (matches(header, 4, ASCII('ftyp'))) {
    const brand = String.fromCharCode(...header.slice(8, 12));

    if (HEIC_BRANDS.includes(brand)) return 'image/heic';
  }

  return null;
}

/**
 * Does the file's own type agree with what was claimed?
 *
 * Separate from detection so the caller can log the disagreement. "Declared
 * PDF, is actually a PNG" is a mistake somebody made; "declared PDF, is
 * actually nothing we recognise" is worth a second look.
 */
export function fileTypeMatchesDeclared(header: Uint8Array, declared: string): boolean {
  const detected = detectFileType(header);

  return detected !== null && detected === declared;
}

function matches(data: Uint8Array, offset: number, pattern: readonly number[]): boolean {
  if (data.length < offset + pattern.length) return false;

  return pattern.every((byte, index) => data[offset + index] === byte);
}

/**
 * A JPEG with its metadata segments removed (FR-EXP-006).
 *
 * ## Why this is not cosmetic
 *
 * A photograph of a restaurant bill taken on a phone carries the GPS
 * coordinates where it was taken, the device's serial number, and the exact
 * time — none of which anybody consented to sharing with their employer's
 * finance team, and all of which travels forward into every export and backup
 * unless it is removed here.
 *
 * ## Why it is written by hand
 *
 * Stripping EXIF properly means an image library, and every image library that
 * does it is a native dependency that decodes attacker-controlled data. This
 * does not decode anything: it walks the JPEG marker structure, copies the
 * segments that carry image data, and drops `APP1` (EXIF, XMP) and `APP2`
 * through `APP15` along with `COM`. Nothing is re-encoded, so the picture is
 * bit-for-bit the picture that was uploaded.
 *
 * Returns the input unchanged for anything that is not a JPEG, including a
 * truncated one — this is a scrubber, not a validator, and a file it cannot
 * parse is one it must not silently corrupt.
 */
export function stripJpegMetadata(data: Uint8Array): Uint8Array {
  if (data.length < 4 || data[0] !== 0xff || data[1] !== 0xd8) return data;

  const output: number[] = [0xff, 0xd8];
  let index = 2;

  while (index + 3 < data.length) {
    if (data[index] !== 0xff) return data;

    const marker = data[index + 1];

    if (marker === undefined) return data;

    // Start of scan: everything from here is entropy-coded image data with no
    // further segment headers to parse, so it is copied wholesale.
    if (marker === 0xda) {
      output.push(...data.slice(index));
      return Uint8Array.from(output);
    }

    // Standalone markers carry no length. RSTn and TEM.
    if ((marker >= 0xd0 && marker <= 0xd9) || marker === 0x01) {
      output.push(0xff, marker);
      index += 2;
      continue;
    }

    const high = data[index + 2];
    const low = data[index + 3];

    if (high === undefined || low === undefined) return data;

    const length = (high << 8) + low;

    // A segment claiming a length that runs past the end of the file is a
    // malformed image; copying the rest verbatim is safer than guessing.
    if (length < 2 || index + 2 + length > data.length) return data;

    const isMetadata = (marker >= 0xe1 && marker <= 0xef) || marker === 0xfe;

    if (!isMetadata) {
      output.push(...data.slice(index, index + 2 + length));
    }

    index += 2 + length;
  }

  return Uint8Array.from(output);
}

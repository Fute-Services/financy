import { describe, expect, it } from 'vitest';

import {
  FILE_TYPE_HEADER_BYTES,
  detectFileType,
  fileTypeMatchesDeclared,
  stripJpegMetadata,
} from './file-type.js';

/**
 * The function between an object store and whatever somebody uploaded.
 *
 * The requirement names one test — "an executable renamed `.pdf` is rejected"
 * (FR-EXP-004) — and that one is here, but a signature check that only
 * recognised the formats it was shown would pass it and still be wrong. So the
 * cases below are grouped by what they would let through if the check were
 * lazier: a prefix compared instead of a signature, a container accepted
 * without its brand, an empty file treated as a match.
 */

const bytes = (...values: number[]): Uint8Array => Uint8Array.from(values);
const ascii = (text: string): number[] => [...text].map((character) => character.charCodeAt(0));
const padded = (...values: number[]): Uint8Array =>
  Uint8Array.from([...values, ...new Array<number>(Math.max(0, 32 - values.length)).fill(0)]);

describe('what a file actually is', () => {
  it('recognises a PDF by its header, whatever version follows', () => {
    expect(detectFileType(padded(...ascii('%PDF-1.4')))).toBe('application/pdf');
    expect(detectFileType(padded(...ascii('%PDF-2.0')))).toBe('application/pdf');
  });

  it('recognises the four image formats', () => {
    expect(detectFileType(padded(0xff, 0xd8, 0xff, 0xe0))).toBe('image/jpeg');
    expect(detectFileType(padded(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe(
      'image/png',
    );
    expect(detectFileType(padded(...ascii('RIFF'), 0, 0, 0, 0, ...ascii('WEBP')))).toBe(
      'image/webp',
    );
    expect(detectFileType(padded(0, 0, 0, 0x18, ...ascii('ftyp'), ...ascii('heic')))).toBe(
      'image/heic',
    );
  });

  /**
   * The requirement's own test, and the reason this module exists.
   *
   * `MZ` is a Windows executable. Renaming it and declaring `application/pdf`
   * changes nothing this check reads.
   */
  it('refuses a Windows executable however it is named or declared', () => {
    const executable = padded(0x4d, 0x5a, 0x90, 0x00, 0x03);

    expect(detectFileType(executable)).toBeNull();
    expect(fileTypeMatchesDeclared(executable, 'application/pdf')).toBe(false);
  });

  it('refuses an ELF binary and a shell script for the same reason', () => {
    expect(detectFileType(padded(0x7f, ...ascii('ELF')))).toBeNull();
    expect(detectFileType(padded(...ascii('#!/bin/sh\n')))).toBeNull();
  });

  /**
   * RIFF is WebP, WAV, and AVI. A check that stopped at the first four bytes
   * would accept an audio file as a receipt — and the person who uploaded it
   * would have a perfectly good reason to believe it worked.
   */
  it('refuses a RIFF container that is not WebP', () => {
    expect(detectFileType(padded(...ascii('RIFF'), 0, 0, 0, 0, ...ascii('WAVE')))).toBeNull();
    expect(detectFileType(padded(...ascii('RIFF'), 0, 0, 0, 0, ...ascii('AVI ')))).toBeNull();
  });

  /**
   * HEIC and MP4 share a box header exactly; only the brand differs. Accepting
   * `ftyp` alone would accept a video, which is a much larger object with a
   * completely different attack surface.
   */
  it('refuses an ISO container whose brand is not a HEIC one', () => {
    expect(detectFileType(padded(0, 0, 0, 0x18, ...ascii('ftyp'), ...ascii('mp42')))).toBeNull();
    expect(detectFileType(padded(0, 0, 0, 0x18, ...ascii('ftyp'), ...ascii('qt  ')))).toBeNull();
  });

  it('refuses an empty file and a truncated header rather than guessing', () => {
    expect(detectFileType(bytes())).toBeNull();
    expect(detectFileType(bytes(0x89, 0x50))).toBeNull();
    expect(detectFileType(bytes(...ascii('%PD')))).toBeNull();
  });

  it('refuses a file whose bytes are one of ours but whose declaration is another', () => {
    const png = padded(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);

    // Detected fine, and still refused: the mismatch is the signal. A file
    // that is not what its uploader said it was is worth stopping even when
    // both types are allowed.
    expect(detectFileType(png)).toBe('image/png');
    expect(fileTypeMatchesDeclared(png, 'application/pdf')).toBe(false);
    expect(fileTypeMatchesDeclared(png, 'image/png')).toBe(true);
  });

  it('needs no more than the header it asks for', () => {
    const header = padded(...ascii('%PDF-1.7')).slice(0, FILE_TYPE_HEADER_BYTES);

    expect(detectFileType(header)).toBe('application/pdf');
  });
});

describe('stripping a photograph’s metadata', () => {
  /**
   * A minimal JPEG: SOI, an APP1 (EXIF) segment, an APP0 (JFIF) segment, a
   * quantisation table, then SOS and some image data.
   */
  function jpegWithExif(): Uint8Array {
    const exifPayload = ascii('Exif\0\0GPS 51.5074 -0.1278 iPhone serial ABC123');
    const app1Length = exifPayload.length + 2;

    return Uint8Array.from([
      0xff,
      0xd8, // SOI
      0xff,
      0xe1,
      (app1Length >> 8) & 0xff,
      app1Length & 0xff,
      ...exifPayload, // APP1
      0xff,
      0xe0,
      0x00,
      0x04,
      0x00,
      0x00, // APP0
      0xff,
      0xdb,
      0x00,
      0x04,
      0x11,
      0x22, // DQT
      0xff,
      0xda,
      0x00,
      0x04,
      0x00,
      0x00, // SOS
      0x12,
      0x34,
      0x56,
      0x78, // entropy-coded data
      0xff,
      0xd9, // EOI
    ]);
  }

  it('removes the location and the device from a photograph', () => {
    const stripped = stripJpegMetadata(jpegWithExif());
    const text = String.fromCharCode(...stripped);

    // What was removed is what nobody agreed to share with their finance team.
    expect(text).not.toContain('GPS');
    expect(text).not.toContain('51.5074');
    expect(text).not.toContain('serial ABC123');
    expect(text).not.toContain('Exif');
  });

  it('keeps the picture, bit for bit', () => {
    const stripped = stripJpegMetadata(jpegWithExif());

    // Still a JPEG, still ends properly, and the entropy-coded data is
    // untouched — nothing is re-encoded, so the image cannot be degraded.
    expect(stripped[0]).toBe(0xff);
    expect(stripped[1]).toBe(0xd8);
    expect([...stripped].slice(-6)).toEqual([0x12, 0x34, 0x56, 0x78, 0xff, 0xd9]);
    // The quantisation table survives; without it the file is not decodable.
    expect([...stripped]).toContain(0xdb);
  });

  it('leaves anything that is not a JPEG completely alone', () => {
    const png = padded(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);

    expect(stripJpegMetadata(png)).toEqual(png);
  });

  /**
   * A scrubber that "fixed" a malformed file would corrupt it. Refusing to
   * touch what it cannot parse is the only safe behaviour, because the
   * alternative silently destroys somebody's receipt.
   */
  it('leaves a truncated or malformed JPEG unchanged', () => {
    const truncated = bytes(0xff, 0xd8, 0xff, 0xe1, 0x00, 0xff);

    expect(stripJpegMetadata(truncated)).toEqual(truncated);
    expect(stripJpegMetadata(bytes(0xff, 0xd8))).toEqual(bytes(0xff, 0xd8));
  });
});

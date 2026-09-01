/**
 * Receipts (FR-EXP-004…007, docs/13 §7, epic 3.1).
 *
 * ## The upload is three steps, and the middle one does not touch this API
 *
 * Intent → upload → complete. The file goes straight to storage under a
 * short-lived signed URL, and this API never receives its bytes. That is not
 * an optimisation: a 20 MB body through the application is 20 MB of memory
 * per concurrent upload, and an endpoint that accepts files is an endpoint
 * somebody points a fuzzer at.
 *
 * ## What is declared is never trusted
 *
 * The browser sends a content type and a size. Both are hints. The completion
 * step reads the object's first bytes and decides for itself what the file is,
 * because `Content-Type: application/pdf` on a Windows executable is one line
 * of code for an attacker and a plausible-looking receipt for everybody else.
 *
 * ## A receipt belongs to at most one thing
 *
 * One transaction *or* one expense, never both and never two of either
 * (FR-EXP-007). The same image attached to two expenses is the mechanism for
 * claiming one lunch twice, and it is prevented rather than reported.
 */

import { z } from 'zod';

import { idSchema, nonEmptyString, timestampSchema } from './primitives.js';

/**
 * What a receipt may be.
 *
 * A closed list, checked against the file's own first bytes rather than
 * against what the browser said (FR-EXP-006). Anything not here is refused at
 * completion, and the object is deleted rather than left in the bucket.
 */
export const RECEIPT_CONTENT_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/heic',
  'image/webp',
] as const;

export type ReceiptContentType = (typeof RECEIPT_CONTENT_TYPES)[number];

export const RECEIPT_CONTENT_TYPE_LABELS: Readonly<Record<ReceiptContentType, string>> = {
  'application/pdf': 'PDF',
  'image/jpeg': 'JPEG image',
  'image/png': 'PNG image',
  'image/heic': 'HEIC image',
  'image/webp': 'WebP image',
};

/** 20 MB (FR-EXP-006). Enforced by the signed URL *and* at completion. */
export const RECEIPT_MAX_BYTES = 20 * 1024 * 1024;

/**
 * Where a receipt is in its life.
 *
 * `PENDING` exists because an intent can be created and never used — a person
 * changes their mind, a tab closes — and the row has to say so rather than
 * looking like a receipt whose file has gone missing.
 */
export const RECEIPT_STATUSES = ['PENDING', 'STORED', 'QUARANTINED', 'DELETED'] as const;
export type ReceiptStatus = (typeof RECEIPT_STATUSES)[number];

export const RECEIPT_STATUS_LABELS: Readonly<Record<ReceiptStatus, string>> = {
  PENDING: 'Waiting for the file',
  STORED: 'Stored',
  QUARANTINED: 'Quarantined',
  DELETED: 'Deleted',
};

/** The scan a file gets after it lands. `SKIPPED` when no scanner is configured. */
export const SCAN_STATUSES = ['PENDING', 'CLEAN', 'INFECTED', 'FAILED', 'SKIPPED'] as const;
export type ScanStatus = (typeof SCAN_STATUSES)[number];

export const OCR_STATUSES = ['PENDING', 'DONE', 'FAILED', 'SKIPPED'] as const;
export type OcrStatus = (typeof OCR_STATUSES)[number];

/**
 * What a receipt can be attached to.
 *
 * Both, and never both at once: one receipt has one open attachment
 * (FR-EXP-007). The same image on an expense claim *and* on a card charge is
 * how one dinner gets paid for twice, from two directions, with each payment
 * looking perfectly ordinary on its own.
 */
export const RECEIPT_TARGET_TYPES = ['transaction', 'expense'] as const;
export type ReceiptTargetType = (typeof RECEIPT_TARGET_TYPES)[number];

/**
 * Asking for somewhere to put a file.
 *
 * The declared content type is checked here so an obviously wrong request
 * fails before an object exists — and checked again against the bytes at
 * completion, because this one is only a claim.
 */
export const createUploadIntentSchema = z.strictObject({
  fileName: nonEmptyString(255),
  contentType: z.enum(RECEIPT_CONTENT_TYPES),
  /** The browser's `File.size`. A hint, used to refuse early. */
  byteSize: z.int().min(1).max(RECEIPT_MAX_BYTES),
});

export const uploadIntentSchema = z.object({
  receiptId: idSchema,
  /** Absolute, short-lived, and single-purpose. */
  uploadUrl: z.string(),
  expiresAt: timestampSchema,
  maxBytes: z.int(),
  /** So the client can label the sandbox honestly (docs/13 §3). */
  provider: z.string(),
  isSandbox: z.boolean(),
});

/**
 * Completing an upload.
 *
 * Deliberately carries nothing about the file. Everything that matters —
 * what it is, how big it is, whether it is what it claimed — is read from the
 * stored object, because a client that could assert its own file's size and
 * type could assert a lie.
 */
export const completeUploadSchema = z.strictObject({});

export const ocrFieldsSchema = z.object({
  merchantName: z.string().nullable(),
  amount: z.object({ amount: z.string(), currency: z.string() }).nullable(),
  transactionDate: timestampSchema.nullable(),
  /** 0..1. Absent rather than zero when nothing was attempted. */
  confidence: z.number().min(0).max(1).nullable(),
});

export const receiptSchema = z.object({
  id: idSchema,
  fileName: z.string(),
  contentType: z.string(),
  byteSize: z.int().min(0),
  status: z.enum(RECEIPT_STATUSES),
  scanStatus: z.enum(SCAN_STATUSES),
  ocrStatus: z.enum(OCR_STATUSES),
  ocr: ocrFieldsSchema.nullable(),
  uploadedBy: z.object({ membershipId: idSchema, fullName: z.string() }).nullable(),
  /** What it is attached to now, if anything. */
  attachedTo: z.object({ targetType: z.enum(RECEIPT_TARGET_TYPES), targetId: idSchema }).nullable(),
  createdAt: timestampSchema,
  storedAt: timestampSchema.nullable(),
});

/**
 * The attach history, kept forever (FR-EXP-007).
 *
 * A receipt moved from one expense to another is a thing an auditor asks
 * about, and a system that only knows where it is now cannot answer.
 */
export const receiptAttachmentSchema = z.object({
  id: idSchema,
  targetType: z.enum(RECEIPT_TARGET_TYPES),
  targetId: idSchema,
  attachedBy: z.string().nullable(),
  attachedAt: timestampSchema,
  detachedAt: timestampSchema.nullable(),
  detachedBy: z.string().nullable(),
});

export const receiptDetailSchema = receiptSchema.extend({
  history: z.array(receiptAttachmentSchema),
  /**
   * A freshly issued, short-lived link (FR-EXP-005).
   *
   * Issued per read after a permission check, never stored and never
   * long-lived — a URL that outlives the check that produced it is a URL that
   * outlives the permission.
   */
  downloadUrl: z.string().nullable(),
  downloadExpiresAt: timestampSchema.nullable(),
});

export const attachReceiptSchema = z.strictObject({
  targetType: z.enum(RECEIPT_TARGET_TYPES),
  targetId: idSchema,
});

export const listReceiptsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).catch(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).catch(25).default(25),
  status: z.enum(RECEIPT_STATUSES).optional(),
  /** Receipts nobody has attached yet — the pile a person works through. */
  unattached: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .transform((value) => value === true || value === 'true')
    .optional(),
  mine: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .transform((value) => value === true || value === 'true')
    .optional(),
});

export type CreateUploadIntent = z.infer<typeof createUploadIntentSchema>;
export type UploadIntent = z.infer<typeof uploadIntentSchema>;
export type ReceiptRecord = z.infer<typeof receiptSchema>;
export type ReceiptDetail = z.infer<typeof receiptDetailSchema>;
export type ReceiptAttachmentRecord = z.infer<typeof receiptAttachmentSchema>;
export type AttachReceipt = z.infer<typeof attachReceiptSchema>;
export type ListReceiptsQuery = z.infer<typeof listReceiptsQuerySchema>;
export type OcrFields = z.infer<typeof ocrFieldsSchema>;

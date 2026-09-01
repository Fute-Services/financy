/**
 * Transactions (docs/10 §5.8, docs/09 §7.2, epic 2.4).
 *
 * ## Four status axes, and the independence is the whole design
 *
 * A card charge on the day it lands is *posted*, *missing its receipt*,
 * *unreviewed*, and *unmapped* — simultaneously and legitimately. One `status`
 * column would force an order on four processes that genuinely run in parallel,
 * and would make "everything settled but still needing a receipt" impossible to
 * ask for. Four columns make the finance queue a filter rather than a
 * convention.
 *
 * ## A posted transaction's money is immutable
 *
 * Amount, currency, merchant, and when it happened cannot change once the
 * transaction is `POSTED`, because somebody has already reconciled against
 * them. A correction is a new linked adjustment row. Everything *about* the
 * transaction — its category, its review, its accounting code — stays mutable,
 * because none of that is the money.
 *
 * ## Import is idempotent on the provider's own identifier
 *
 * Re-running the same file writes nothing new. That is a unique index rather
 * than a check, so it holds under two people importing at the same moment —
 * and the response reports per row, because "417 imported, 3 skipped, 1 failed
 * on line 88" is what somebody can act on and "import complete" is not.
 */

import { z } from 'zod';

import {
  idSchema,
  moneySchema,
  nonEmptyString,
  optionalText,
  timestampSchema,
  versionSchema,
} from './primitives.js';

export const TRANSACTION_SOURCES = ['CARD', 'IMPORT', 'MANUAL', 'PROVIDER'] as const;
export const TRANSACTION_STATUSES = ['PENDING', 'POSTED', 'DECLINED', 'REVERSED'] as const;
export const RECEIPT_STATUSES = ['NOT_REQUIRED', 'MISSING', 'REQUESTED', 'ATTACHED'] as const;
export const REVIEW_STATUSES = ['PENDING', 'IN_REVIEW', 'REVIEWED', 'DISPUTED'] as const;
export const ACCOUNTING_STATUSES = ['UNMAPPED', 'MAPPED', 'EXPORTED'] as const;
export const MATCH_STATUSES = [
  'UNMATCHED',
  'AUTO_MATCHED',
  'MANUALLY_MATCHED',
  'NOT_APPLICABLE',
] as const;

export type TransactionSource = (typeof TRANSACTION_SOURCES)[number];
export type TransactionStatus = (typeof TRANSACTION_STATUSES)[number];
export type ReceiptStatus = (typeof RECEIPT_STATUSES)[number];
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];
export type AccountingStatus = (typeof ACCOUNTING_STATUSES)[number];
export type MatchStatus = (typeof MATCH_STATUSES)[number];

export const TRANSACTION_STATUS_LABELS: Readonly<Record<TransactionStatus, string>> = {
  PENDING: 'Pending',
  POSTED: 'Posted',
  DECLINED: 'Declined',
  REVERSED: 'Reversed',
};

export const RECEIPT_STATUS_LABELS: Readonly<Record<ReceiptStatus, string>> = {
  NOT_REQUIRED: 'Not required',
  MISSING: 'Missing',
  REQUESTED: 'Requested',
  ATTACHED: 'Attached',
};

export const REVIEW_STATUS_LABELS: Readonly<Record<ReviewStatus, string>> = {
  PENDING: 'Not reviewed',
  IN_REVIEW: 'Being reviewed',
  REVIEWED: 'Reviewed',
  DISPUTED: 'Disputed',
};

export const ACCOUNTING_STATUS_LABELS: Readonly<Record<AccountingStatus, string>> = {
  UNMAPPED: 'Not coded',
  MAPPED: 'Coded',
  EXPORTED: 'Exported',
};

export const MATCH_STATUS_LABELS: Readonly<Record<MatchStatus, string>> = {
  UNMATCHED: 'No request',
  AUTO_MATCHED: 'Matched automatically',
  MANUALLY_MATCHED: 'Matched',
  NOT_APPLICABLE: 'Unplanned',
};

export const transactionSchema = z.object({
  id: idSchema,
  entityId: idSchema,
  cardId: idSchema.nullable(),
  card: z.object({ id: idSchema, name: z.string(), lastFour: z.string().nullable() }).nullable(),
  member: z.object({ membershipId: idSchema, fullName: z.string() }).nullable(),
  departmentId: idSchema.nullable(),
  projectId: idSchema.nullable(),
  categoryId: idSchema.nullable(),
  spendRequestId: idSchema.nullable(),
  merchantName: z.string(),
  merchantRaw: z.string().nullable(),
  amount: z.object({ amount: z.string(), currency: z.string() }),
  billingAmount: z.object({ amount: z.string(), currency: z.string() }).nullable(),
  source: z.enum(TRANSACTION_SOURCES),
  status: z.enum(TRANSACTION_STATUSES),
  receiptStatus: z.enum(RECEIPT_STATUSES),
  reviewStatus: z.enum(REVIEW_STATUSES),
  accountingStatus: z.enum(ACCOUNTING_STATUSES),
  matchStatus: z.enum(MATCH_STATUSES),
  memo: z.string().nullable(),
  occurredAt: timestampSchema,
  postedAt: timestampSchema.nullable(),
  reviewedBy: z.string().nullable(),
  reviewedAt: timestampSchema.nullable(),
  reviewNote: z.string().nullable(),
  provider: z.string(),
  providerTransactionId: z.string(),
  createdAt: timestampSchema,
  version: versionSchema,
});

export const transactionAdjustmentSchema = z.object({
  id: idSchema,
  adjustmentType: z.string(),
  amount: z.object({ amount: z.string(), currency: z.string() }),
  reason: z.string(),
  createdBy: z.string().nullable(),
  createdAt: timestampSchema,
});

export const transactionDetailSchema = transactionSchema.extend({
  adjustments: z.array(transactionAdjustmentSchema),
  /** The authorisation this fulfils, resolved for display. */
  spendRequest: z.object({ id: idSchema, reference: z.string(), purpose: z.string() }).nullable(),
});

/**
 * Coding a transaction.
 *
 * Category, department, project, and a memo — the four things a human decides
 * about a charge after it has happened. Not the amount, not the merchant, not
 * the date: those are the money, and on a posted transaction they are immutable.
 */
export const categorizeTransactionSchema = z
  .strictObject({
    categoryId: idSchema.nullable().optional(),
    departmentId: idSchema.nullable().optional(),
    projectId: idSchema.nullable().optional(),
    memo: z.string().trim().max(2000).nullable().optional(),
  })
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: 'Supply at least one field to change.',
  });

/**
 * Completing finance review.
 *
 * `DISPUTED` requires a note, because a dispute is somebody else's next
 * action — and a disputed charge with no explanation is a charge that sits in
 * the queue forever while two people wait for each other.
 */
export const reviewTransactionSchema = z
  .strictObject({
    reviewStatus: z.enum(['IN_REVIEW', 'REVIEWED', 'DISPUTED']),
    note: z.string().trim().max(1000).nullable().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.reviewStatus === 'DISPUTED' && (value.note ?? '') === '') {
      ctx.addIssue({
        code: 'custom',
        path: ['note'],
        message: 'Say what is wrong with it. A dispute with no reason cannot be resolved.',
      });
    }
  });

/** Link a transaction to the request that authorised it, or unlink it. */
export const matchTransactionSchema = z.strictObject({
  /** Null unlinks. `NOT_APPLICABLE` marks it a genuine unplanned purchase. */
  spendRequestId: idSchema.nullable(),
  notApplicable: z.boolean().default(false),
});

export const createAdjustmentSchema = z.strictObject({
  adjustmentType: z.enum(['REFUND', 'CHARGEBACK', 'FEE', 'CORRECTION']),
  amount: moneySchema,
  reason: nonEmptyString(500),
});

/**
 * One row of an import, as it arrives.
 *
 * `providerTransactionId` is what makes the import idempotent, so it is
 * required rather than generated. A file whose rows have no stable identifier
 * cannot be re-imported safely, and inventing one here would hide that.
 */
export const importTransactionRowSchema = z.strictObject({
  providerTransactionId: nonEmptyString(200),
  cardId: idSchema.nullable().optional(),
  entityId: idSchema,
  merchantName: nonEmptyString(300),
  merchantRaw: optionalText(500),
  amount: moneySchema,
  occurredAt: timestampSchema,
  postedAt: timestampSchema.nullable().optional(),
  status: z.enum(TRANSACTION_STATUSES).default('POSTED'),
  memo: optionalText(2000),
});

export const importTransactionsSchema = z.strictObject({
  provider: nonEmptyString(50),
  rows: z.array(importTransactionRowSchema).min(1).max(1000),
  /**
   * Try to link each row to an open spend request.
   *
   * Off by default. An automatic match is a guess, and a guess that quietly
   * consumes somebody's authorisation is worse than no match at all — so it is
   * asked for, recorded as automatic, and reversible.
   */
  autoMatch: z.boolean().default(false),
});

/**
 * Per row, not per file.
 *
 * "Import complete" is not something anybody can act on. "417 imported, 3
 * already present, 1 failed on row 88 because its entity is archived" is.
 */
export const importResultSchema = z.object({
  imported: z.int().min(0),
  skipped: z.int().min(0),
  failed: z.int().min(0),
  matched: z.int().min(0),
  rows: z.array(
    z.object({
      index: z.int().min(0),
      providerTransactionId: z.string(),
      outcome: z.enum(['IMPORTED', 'SKIPPED_DUPLICATE', 'FAILED']),
      transactionId: idSchema.nullable(),
      matchedSpendRequestId: idSchema.nullable(),
      message: z.string().nullable(),
    }),
  ),
});

export const listTransactionsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).catch(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).catch(25).default(25),
  status: z.enum(TRANSACTION_STATUSES).optional(),
  reviewStatus: z.enum(REVIEW_STATUSES).optional(),
  receiptStatus: z.enum(RECEIPT_STATUSES).optional(),
  matchStatus: z.enum(MATCH_STATUSES).optional(),
  cardId: idSchema.optional(),
  categoryId: idSchema.optional(),
  departmentId: idSchema.optional(),
  from: timestampSchema.optional(),
  to: timestampSchema.optional(),
  q: optionalText(200),
  mine: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .transform((value) => value === true || value === 'true')
    .optional(),
});

export type TransactionRecord = z.infer<typeof transactionSchema>;
export type TransactionDetail = z.infer<typeof transactionDetailSchema>;
export type TransactionAdjustmentRecord = z.infer<typeof transactionAdjustmentSchema>;
export type CategorizeTransaction = z.infer<typeof categorizeTransactionSchema>;
export type ReviewTransaction = z.infer<typeof reviewTransactionSchema>;
export type MatchTransaction = z.infer<typeof matchTransactionSchema>;
export type CreateAdjustment = z.infer<typeof createAdjustmentSchema>;
export type ImportTransactions = z.infer<typeof importTransactionsSchema>;
export type ImportTransactionRow = z.infer<typeof importTransactionRowSchema>;
export type ImportResult = z.infer<typeof importResultSchema>;
export type ListTransactionsQuery = z.infer<typeof listTransactionsQuerySchema>;

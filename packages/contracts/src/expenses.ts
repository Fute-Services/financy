/**
 * Expenses and reimbursements (FR-EXP-001…003, 008…010; epics 3.2 and 3.3).
 *
 * ## An expense is the opposite of a spend request, in one important way
 *
 * A spend request asks *before*. An expense reports *after*, and the money is
 * already gone. So a rejected expense does not stop any spending — it refuses
 * the reimbursement, or flags a card charge as out of policy. Collapsing the
 * two into one record would make "rejected" mean two different things to the
 * person reading it.
 *
 * ## How it was paid decides what approval is for
 *
 * Out of pocket, approving authorises paying somebody back. On a company card,
 * the money has already left the company and approving is a review. The two
 * carry different spend types into the policy engine, so an organisation can
 * govern them differently — which most do.
 *
 * ## Nothing here carries a total the client computed
 *
 * When an expense has items, its total is the sum of them, computed on the
 * server. A submitted total that disagreed with its own lines is a number that
 * gets paid and then reconciled by hand for a week.
 */

import { z } from 'zod';

import {
  idSchema,
  nonEmptyString,
  optionalText,
  positiveMoneySchema,
  timestampSchema,
  versionSchema,
} from './primitives.js';

export const EXPENSE_PAYMENT_METHODS = ['OUT_OF_POCKET', 'COMPANY_CARD'] as const;
export type ExpensePaymentMethod = (typeof EXPENSE_PAYMENT_METHODS)[number];

export const EXPENSE_PAYMENT_METHOD_LABELS: Readonly<Record<ExpensePaymentMethod, string>> = {
  OUT_OF_POCKET: 'I paid for this myself',
  COMPANY_CARD: 'Paid on a company card',
};

export const EXPENSE_STATUSES = [
  'DRAFT',
  'PENDING_APPROVAL',
  'CHANGES_REQUESTED',
  'APPROVED',
  'REJECTED',
  'CANCELLED',
  'REIMBURSED',
] as const;

export type ExpenseStatus = (typeof EXPENSE_STATUSES)[number];

export const EXPENSE_STATUS_LABELS: Readonly<Record<ExpenseStatus, string>> = {
  DRAFT: 'Draft',
  PENDING_APPROVAL: 'Awaiting approval',
  CHANGES_REQUESTED: 'Changes requested',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  CANCELLED: 'Cancelled',
  REIMBURSED: 'Reimbursed',
};

export const expenseItemInputSchema = z.strictObject({
  description: nonEmptyString(200),
  amount: positiveMoneySchema,
  categoryId: idSchema.nullable().optional(),
});

export const createExpenseSchema = z.strictObject({
  paymentMethod: z.enum(EXPENSE_PAYMENT_METHODS).default('OUT_OF_POCKET'),
  entityId: idSchema,
  merchantName: nonEmptyString(200),
  /**
   * The total, or absent when items carry it.
   *
   * Exactly one of the two must decide. An expense supplying both a total and
   * items that sum to something else is a disagreement no server can resolve
   * in the client's favour without picking a number nobody chose.
   */
  amount: positiveMoneySchema.optional(),
  items: z.array(expenseItemInputSchema).max(50).optional(),
  /** A calendar day: when the money was spent, not when the claim was filed. */
  expenseDate: z.iso.date(),
  departmentId: idSchema.nullable().optional(),
  projectId: idSchema.nullable().optional(),
  categoryId: idSchema.nullable().optional(),
  memo: optionalText(2000),
  /** The charge this explains, for a card expense. */
  transactionId: idSchema.nullable().optional(),
});

export const updateExpenseSchema = createExpenseSchema
  .partial()
  .extend({ paymentMethod: z.enum(EXPENSE_PAYMENT_METHODS).optional() })
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: 'Supply at least one field to change.',
  });

export const expenseItemSchema = z.object({
  id: idSchema,
  description: z.string(),
  amount: z.object({ amount: z.string(), currency: z.string() }),
  categoryId: idSchema.nullable(),
});

export const expenseSchema = z.object({
  id: idSchema,
  reference: z.string(),
  status: z.enum(EXPENSE_STATUSES),
  paymentMethod: z.enum(EXPENSE_PAYMENT_METHODS),
  submitter: z.object({ membershipId: idSchema, fullName: z.string() }),
  entityId: idSchema,
  departmentId: idSchema.nullable(),
  projectId: idSchema.nullable(),
  categoryId: idSchema.nullable(),
  transactionId: idSchema.nullable(),
  merchantName: z.string(),
  amount: z.object({ amount: z.string(), currency: z.string() }),
  expenseDate: timestampSchema,
  memo: z.string().nullable(),
  items: z.array(expenseItemSchema),
  /** Attached evidence, resolved for display. */
  receiptIds: z.array(idSchema),
  policyDecision: z.unknown().nullable(),
  approvalInstanceId: idSchema.nullable(),
  submittedAt: timestampSchema.nullable(),
  decidedAt: timestampSchema.nullable(),
  createdAt: timestampSchema,
  version: versionSchema,
});

export const listExpensesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).catch(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).catch(25).default(25),
  status: z.enum(EXPENSE_STATUSES).optional(),
  paymentMethod: z.enum(EXPENSE_PAYMENT_METHODS).optional(),
  mine: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .transform((value) => value === true || value === 'true')
    .optional(),
  q: optionalText(200),
});

// ── Reimbursements ─────────────────────────────────────────────────────────

export const REIMBURSEMENT_STATUSES = ['DRAFT', 'APPROVED', 'PAID', 'CANCELLED'] as const;
export type ReimbursementStatus = (typeof REIMBURSEMENT_STATUSES)[number];

export const REIMBURSEMENT_STATUS_LABELS: Readonly<Record<ReimbursementStatus, string>> = {
  DRAFT: 'Being prepared',
  APPROVED: 'Ready to pay',
  PAID: 'Paid',
  CANCELLED: 'Cancelled',
};

/**
 * Building a batch.
 *
 * The caller names the person, the entity, the currency, and the period; the
 * server finds the approved expenses that match and computes the total. A
 * request that listed expense ids would let somebody assemble a batch that
 * crosses currencies or people, which is a payment nobody can make.
 */
export const createReimbursementSchema = z.strictObject({
  payeeMembershipId: idSchema,
  entityId: idSchema,
  currency: z.string().length(3),
  periodStart: z.iso.date(),
  periodEnd: z.iso.date(),
});

/**
 * Marking a batch paid.
 *
 * The reference is mandatory (FR-EXP-010). A payment nobody can find in a bank
 * statement is a payment nobody can prove was made, and "paid" with no
 * reference is exactly the state a dispute starts from.
 */
export const markReimbursementPaidSchema = z.strictObject({
  paymentReference: nonEmptyString(100),
  paidAt: timestampSchema.optional(),
});

export const reimbursementLineSchema = z.object({
  id: idSchema,
  expenseId: idSchema,
  reference: z.string(),
  merchantName: z.string(),
  expenseDate: timestampSchema,
  amount: z.object({ amount: z.string(), currency: z.string() }),
});

export const reimbursementSchema = z.object({
  id: idSchema,
  reference: z.string(),
  status: z.enum(REIMBURSEMENT_STATUSES),
  payee: z.object({ membershipId: idSchema, fullName: z.string() }),
  entityId: idSchema,
  currency: z.string(),
  periodStart: timestampSchema,
  periodEnd: timestampSchema,
  /** Summed from the lines on the server, never supplied. */
  total: z.object({ amount: z.string(), currency: z.string() }),
  lineCount: z.int().min(0),
  paymentReference: z.string().nullable(),
  paidAt: timestampSchema.nullable(),
  approvedAt: timestampSchema.nullable(),
  createdAt: timestampSchema,
  version: versionSchema,
});

export const reimbursementDetailSchema = reimbursementSchema.extend({
  lines: z.array(reimbursementLineSchema),
});

export const listReimbursementsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).catch(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).catch(25).default(25),
  status: z.enum(REIMBURSEMENT_STATUSES).optional(),
  mine: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .transform((value) => value === true || value === 'true')
    .optional(),
});

export type CreateExpense = z.infer<typeof createExpenseSchema>;
export type UpdateExpense = z.infer<typeof updateExpenseSchema>;
export type ExpenseRecord = z.infer<typeof expenseSchema>;
export type ExpenseItemRecord = z.infer<typeof expenseItemSchema>;
export type ListExpensesQuery = z.infer<typeof listExpensesQuerySchema>;
export type CreateReimbursement = z.infer<typeof createReimbursementSchema>;
export type MarkReimbursementPaid = z.infer<typeof markReimbursementPaidSchema>;
export type ReimbursementRecord = z.infer<typeof reimbursementSchema>;
export type ReimbursementDetail = z.infer<typeof reimbursementDetailSchema>;
export type ReimbursementLineRecord = z.infer<typeof reimbursementLineSchema>;
export type ListReimbursementsQuery = z.infer<typeof listReimbursementsQuerySchema>;

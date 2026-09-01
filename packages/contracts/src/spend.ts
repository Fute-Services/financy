/**
 * Spend requests — the first thing in this product that is about money
 * (docs/10 §5.5, task 2.3).
 *
 * A spend request is a request to spend, made *before* anything is spent. It
 * carries an amount, a purpose, and a classification; submitting it evaluates
 * the organisation's policies and, if they call for one, builds an approval
 * chain. Nothing here moves money — that is Phase 7 — which is exactly why it
 * is worth getting right first: every control the product offers is applied
 * here, where reversing a mistake costs nothing.
 */

import { z } from 'zod';

import {
  idSchema,
  nonEmptyString,
  positiveMoneySchema,
  timestampSchema,
  versionSchema,
} from './primitives.js';
import { spendTypeSchema } from './policy.js';

export const SPEND_REQUEST_STATUSES = [
  'DRAFT',
  'SUBMITTED',
  'PENDING_APPROVAL',
  'APPROVED',
  'REJECTED',
  'CANCELLED',
  'EXPIRED',
] as const;

export type SpendRequestStatus = (typeof SPEND_REQUEST_STATUSES)[number];

export const SPEND_STATUS_LABELS: Readonly<Record<SpendRequestStatus, string>> = {
  DRAFT: 'Draft',
  SUBMITTED: 'Submitted',
  PENDING_APPROVAL: 'Awaiting approval',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  CANCELLED: 'Cancelled',
  EXPIRED: 'Expired',
};

/**
 * `POST /v1/spend-requests`.
 *
 * The amount is `Money`, never a number: a float amount is a rounding error
 * waiting for a total, and this is the field every policy limit compares
 * against.
 *
 * `status` is absent, and so is `policyDecision`. A request is created as a
 * draft and submitted separately, because submission is what evaluates policy
 * and builds a chain — a create that could arrive already `APPROVED` would be
 * a way around every control the product has.
 */
export const createSpendRequestSchema = z.strictObject({
  spendType: spendTypeSchema.default('SPEND_REQUEST'),
  amount: positiveMoneySchema,
  entityId: idSchema,
  departmentId: idSchema.nullable().optional(),
  projectId: idSchema.nullable().optional(),
  categoryId: idSchema.nullable().optional(),
  purpose: nonEmptyString(500),
  memo: z.string().trim().max(2000).nullable().optional(),
  /** A calendar day, not an instant — "needed by the 12th" is a date. */
  neededBy: z.iso.date().nullable().optional(),
});

export const updateSpendRequestSchema = z
  .strictObject({
    amount: positiveMoneySchema.optional(),
    departmentId: idSchema.nullable().optional(),
    projectId: idSchema.nullable().optional(),
    categoryId: idSchema.nullable().optional(),
    purpose: nonEmptyString(500).optional(),
    memo: z.string().trim().max(2000).nullable().optional(),
    neededBy: z.iso.date().nullable().optional(),
  })
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: 'Supply at least one field to change.',
  });

/** The decision, as it is stored and shown. Never recomputed for display. */
export const policyDecisionSchema = z.object({
  verdict: z.enum(['ALLOWED', 'ALLOWED_WITH_APPROVAL', 'AUTO_APPROVED', 'BLOCKED']),
  requirements: z.object({
    approvalSteps: z.array(
      z.object({
        sequence: z.int(),
        stepType: z.string(),
        approvers: z.array(z.unknown()),
        timeoutHours: z.number().nullable(),
        escalation: z.unknown().nullable(),
      }),
    ),
    requireReceipt: z.boolean(),
    requireMemo: z.object({ required: z.boolean(), minLength: z.int() }),
    requireFinanceReview: z.boolean(),
    validityDays: z.number().nullable(),
  }),
  blocks: z.array(z.object({ reasonCode: z.string(), message: z.string(), ruleId: z.string() })),
  exceptions: z.array(z.object({ exceptionCode: z.string(), ruleId: z.string() })),
  evaluation: z.object({
    matchedRuleIds: z.array(z.string()),
    policyVersionIds: z.array(z.string()),
    evaluatedAt: timestampSchema,
    engineVersion: z.string(),
    durationMs: z.number(),
  }),
});

export const spendRequestSchema = z.object({
  id: idSchema,
  reference: nonEmptyString(30),
  spendType: spendTypeSchema,
  amount: z.object({ amount: z.string(), currency: z.string() }),
  amountInBaseCurrency: z.object({ amount: z.string(), currency: z.string() }),
  purpose: nonEmptyString(500),
  memo: z.string().nullable(),
  neededBy: z.iso.date().nullable(),
  status: z.enum(SPEND_REQUEST_STATUSES),
  requester: z.object({ membershipId: idSchema, fullName: z.string() }),
  entityId: idSchema,
  departmentId: idSchema.nullable(),
  projectId: idSchema.nullable(),
  categoryId: idSchema.nullable(),
  /** Present from submission onwards. Null on a draft, which has none yet. */
  policyDecision: policyDecisionSchema.nullable(),
  approvalInstanceId: idSchema.nullable(),
  validUntil: timestampSchema.nullable(),
  submittedAt: timestampSchema.nullable(),
  decidedAt: timestampSchema.nullable(),
  createdAt: timestampSchema,
  version: versionSchema,
});

export const listSpendRequestsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).catch(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).catch(25).default(25),
  status: z.enum(SPEND_REQUEST_STATUSES).optional(),
  /** Only what the caller raised. The default is everything in their scope. */
  mine: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .transform((value) => value === true || value === 'true')
    .optional(),
});

export type CreateSpendRequest = z.infer<typeof createSpendRequestSchema>;
export type UpdateSpendRequest = z.infer<typeof updateSpendRequestSchema>;
export type SpendRequestRecord = z.infer<typeof spendRequestSchema>;
export type ListSpendRequestsQuery = z.infer<typeof listSpendRequestsQuerySchema>;
export type StoredPolicyDecision = z.infer<typeof policyDecisionSchema>;

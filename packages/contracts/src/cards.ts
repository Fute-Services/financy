/**
 * Cards (docs/10 §5.7, epic 2.4).
 *
 * ## Nothing here carries a card number
 *
 * There is no `pan`, no `cvv`, and no full expiry — not redacted, **absent**.
 * A field that does not exist cannot be logged by accident, cannot appear in an
 * error envelope, and cannot be in a backup. What travels is a provider
 * reference, the last four digits, and the expiry month and year: enough for a
 * person to recognise their own card, and nothing anybody could spend with.
 * The credential lives with the issuer, behind the `CardProvider` port.
 *
 * ## A card is a spending authorisation
 *
 * Its limit is the control, and the limit has a **period**: "€2,000" means
 * nothing until you say whether that is per transaction, per month, or for the
 * life of the card. Every limit here carries one, and there is no default that
 * would let the ambiguity through.
 *
 * ## Freezing and terminating are different operations, deliberately
 *
 * Freezing is reversible and is what somebody does when a card is mislaid.
 * Termination is permanent — the provider destroys the credential — and a
 * single "deactivate" that did whichever seemed right is how a card somebody
 * would have found in an hour gets thrown away.
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

export const CARD_TYPES = ['VIRTUAL', 'PHYSICAL'] as const;
export type CardType = (typeof CARD_TYPES)[number];

export const CARD_TYPE_LABELS: Readonly<Record<CardType, string>> = {
  VIRTUAL: 'Virtual',
  PHYSICAL: 'Physical',
};

export const CARD_STATUSES = ['PENDING', 'ACTIVE', 'FROZEN', 'TERMINATED'] as const;
export type CardStatus = (typeof CARD_STATUSES)[number];

export const CARD_STATUS_LABELS: Readonly<Record<CardStatus, string>> = {
  PENDING: 'Being issued',
  ACTIVE: 'Active',
  FROZEN: 'Frozen',
  TERMINATED: 'Terminated',
};

export const LIMIT_PERIODS = [
  'PER_TRANSACTION',
  'DAILY',
  'WEEKLY',
  'MONTHLY',
  'QUARTERLY',
  'YEARLY',
  'TOTAL',
] as const;

export type LimitPeriod = (typeof LIMIT_PERIODS)[number];

export const LIMIT_PERIOD_LABELS: Readonly<Record<LimitPeriod, string>> = {
  PER_TRANSACTION: 'per transaction',
  DAILY: 'per day',
  WEEKLY: 'per week',
  MONTHLY: 'per month',
  QUARTERLY: 'per quarter',
  YEARLY: 'per year',
  TOTAL: 'in total, ever',
};

export const issueCardSchema = z.strictObject({
  name: nonEmptyString(100),
  cardType: z.enum(CARD_TYPES).default('VIRTUAL'),
  holderMembershipId: idSchema,
  entityId: idSchema,
  departmentId: idSchema.nullable().optional(),
  projectId: idSchema.nullable().optional(),
  categoryId: idSchema.nullable().optional(),
  /**
   * Required, with no default.
   *
   * A card issued without a limit is an unlimited card, and "we will set it
   * later" is how one stays unlimited. The period is required for the same
   * reason: an amount with no period is a number nobody can enforce.
   */
  limit: positiveMoneySchema,
  limitPeriod: z.enum(LIMIT_PERIODS),
  validUntil: timestampSchema.nullable().optional(),
});

export const updateCardSchema = z
  .strictObject({
    name: nonEmptyString(100).optional(),
    departmentId: idSchema.nullable().optional(),
    projectId: idSchema.nullable().optional(),
    categoryId: idSchema.nullable().optional(),
    validUntil: timestampSchema.nullable().optional(),
  })
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: 'Supply at least one field to change.',
  });

/**
 * Changing a limit needs a reason, and the reason is stored forever.
 *
 * "Who raised this card to 50,000 and why?" is a question an auditor asks, and
 * the limit history is the only thing that can answer it. A change without a
 * reason produces a row that records the what and loses the why.
 */
export const setCardLimitSchema = z.strictObject({
  limit: positiveMoneySchema,
  limitPeriod: z.enum(LIMIT_PERIODS),
  reason: nonEmptyString(300),
});

/**
 * Freezing, unfreezing, and terminating all take a reason.
 *
 * The holder sees it. A card that stopped working with no explanation is a
 * support ticket and, more often, a person quietly assuming the system is
 * broken.
 */
export const changeCardStatusSchema = z.strictObject({
  reason: nonEmptyString(300),
});

export const cardLimitHistorySchema = z.object({
  id: idSchema,
  amount: z.string(),
  currency: z.string(),
  period: z.enum(LIMIT_PERIODS),
  reason: z.string().nullable(),
  setBy: z.string().nullable(),
  effectiveFrom: timestampSchema,
});

export const cardSchema = z.object({
  id: idSchema,
  name: nonEmptyString(100),
  cardType: z.enum(CARD_TYPES),
  status: z.enum(CARD_STATUSES),
  holder: z.object({ membershipId: idSchema, fullName: z.string() }),
  entityId: idSchema,
  departmentId: idSchema.nullable(),
  projectId: idSchema.nullable(),
  categoryId: idSchema.nullable(),
  limit: z.object({ amount: z.string(), currency: z.string() }),
  limitPeriod: z.enum(LIMIT_PERIODS),
  provider: z.string(),
  /** Four digits, or null while the provider is still issuing it. */
  lastFour: z.string().nullable(),
  /** Month and year only. There is deliberately no day, and no PAN. */
  expiryMonth: z.int().min(1).max(12).nullable(),
  expiryYear: z.int().nullable(),
  validUntil: timestampSchema.nullable(),
  statusReason: z.string().nullable(),
  archivedAt: timestampSchema.nullable(),
  createdAt: timestampSchema,
  version: versionSchema,
});

export const cardDetailSchema = cardSchema.extend({
  limitHistory: z.array(cardLimitHistorySchema),
  /**
   * What has been spent against this card, computed server-side.
   *
   * Never derived in the browser from a page of transactions: that would be a
   * figure taken from twenty-five rows and presented as a total (docs/19).
   */
  spentInPeriod: z.object({ amount: z.string(), currency: z.string() }),
  transactionCount: z.int().min(0),
});

export const listCardsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).catch(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).catch(25).default(25),
  status: z.enum(CARD_STATUSES).optional(),
  holderMembershipId: idSchema.optional(),
  /** Only the caller's own. The default for anybody without `card:read_all`. */
  mine: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .transform((value) => value === true || value === 'true')
    .optional(),
  q: optionalText(100),
});

export type IssueCard = z.infer<typeof issueCardSchema>;
export type UpdateCard = z.infer<typeof updateCardSchema>;
export type SetCardLimit = z.infer<typeof setCardLimitSchema>;
export type ChangeCardStatus = z.infer<typeof changeCardStatusSchema>;
export type CardRecord = z.infer<typeof cardSchema>;
export type CardDetail = z.infer<typeof cardDetailSchema>;
export type CardLimitHistory = z.infer<typeof cardLimitHistorySchema>;
export type ListCardsQuery = z.infer<typeof listCardsQuerySchema>;

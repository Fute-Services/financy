/**
 * Budgets (FR-BDG-001…008; epic 4.1).
 *
 * ## A budget is drawn around exactly one thing
 *
 * A department, an entity, a project, a category, or the whole organisation —
 * one of them, never two. A budget scoped to "the design department *and* the
 * travel category" sounds richer and is unanswerable: when a charge matches one
 * dimension and not the other, every answer about whether it counts is
 * defensible and at least one of them is wrong. Two dimensions is two budgets.
 *
 * ## The balances on a line are a cache, and the ledger is the truth
 *
 * Every change is an append-only movement. `allocated`, `committed`, and
 * `actual` are materialised in the same transaction that appends, and an
 * invariant test re-sums the ledger and fails the build on any drift. Nothing
 * is ever deleted: a cancelled commitment is a `RELEASE`, which means the
 * history of a budget explains itself without anybody reconstructing it.
 *
 * ## Remaining is not a stored number
 *
 * `remaining = allocated − committed − actual`, computed where it is read. A
 * fourth stored column would be a fourth thing that can disagree with the
 * other three.
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

export const BUDGET_SCOPE_TYPES = [
  'DEPARTMENT',
  'ENTITY',
  'PROJECT',
  'CATEGORY',
  'ORGANIZATION',
] as const;
export type BudgetScopeType = (typeof BUDGET_SCOPE_TYPES)[number];

export const BUDGET_SCOPE_TYPE_LABELS: Readonly<Record<BudgetScopeType, string>> = {
  DEPARTMENT: 'A department',
  ENTITY: 'A legal entity',
  PROJECT: 'A project',
  CATEGORY: 'A spend category',
  ORGANIZATION: 'The whole organisation',
};

export const BUDGET_PERIOD_GRANULARITIES = ['MONTHLY', 'QUARTERLY', 'ANNUAL'] as const;
export type BudgetPeriodGranularity = (typeof BUDGET_PERIOD_GRANULARITIES)[number];

export const BUDGET_PERIOD_GRANULARITY_LABELS: Readonly<
  Record<BudgetPeriodGranularity, string>
> = {
  MONTHLY: 'Month by month',
  QUARTERLY: 'Quarter by quarter',
  ANNUAL: 'One period for the year',
};

export const BUDGET_OVERSPEND_BEHAVIORS = ['WARN', 'REQUIRE_APPROVAL', 'BLOCK'] as const;
export type BudgetOverspendBehavior = (typeof BUDGET_OVERSPEND_BEHAVIORS)[number];

export const BUDGET_OVERSPEND_BEHAVIOR_LABELS: Readonly<
  Record<BudgetOverspendBehavior, string>
> = {
  WARN: 'Let it through and record the exception',
  REQUIRE_APPROVAL: 'Send it for approval',
  BLOCK: 'Refuse it',
};

export const BUDGET_STATUSES = ['DRAFT', 'ACTIVE', 'CLOSED', 'ARCHIVED'] as const;
export type BudgetStatus = (typeof BUDGET_STATUSES)[number];

export const BUDGET_STATUS_LABELS: Readonly<Record<BudgetStatus, string>> = {
  DRAFT: 'Draft',
  ACTIVE: 'Active',
  CLOSED: 'Closed',
  ARCHIVED: 'Archived',
};

export const BUDGET_MOVEMENT_TYPES = ['COMMITMENT', 'ACTUAL', 'RELEASE', 'ADJUSTMENT'] as const;
export type BudgetMovementType = (typeof BUDGET_MOVEMENT_TYPES)[number];

export const BUDGET_MOVEMENT_TYPE_LABELS: Readonly<Record<BudgetMovementType, string>> = {
  COMMITMENT: 'Reserved',
  ACTUAL: 'Spent',
  RELEASE: 'Released',
  ADJUSTMENT: 'Adjusted',
};

export const BUDGET_MOVEMENT_DIRECTIONS = ['INCREASE', 'DECREASE'] as const;
export type BudgetMovementDirection = (typeof BUDGET_MOVEMENT_DIRECTIONS)[number];

export const BUDGET_SOURCE_TYPES = [
  'SPEND_REQUEST',
  'TRANSACTION',
  'EXPENSE',
  'BILL',
  'PURCHASE_ORDER',
  'MANUAL',
] as const;
export type BudgetSourceType = (typeof BUDGET_SOURCE_TYPES)[number];

/**
 * Thresholds are whole percentages, ascending, and deduplicated.
 *
 * Ascending because the alert copy says "crossed 90%" and a list that went
 * 90, 75 would fire them in an order that reads as the budget recovering.
 */
export const alertThresholdsSchema = z
  .array(z.int().min(1).max(500))
  .max(10)
  .default([75, 90, 100])
  .refine(
    (values) => new Set(values).size === values.length,
    'The same threshold cannot appear twice.',
  )
  .refine(
    (values) => values.every((value, index) => index === 0 || value > (values[index - 1] ?? 0)),
    'Thresholds must ascend.',
  );

export const createBudgetSchema = z
  .strictObject({
    name: nonEmptyString(200),
    scopeType: z.enum(BUDGET_SCOPE_TYPES),
    /** The department, entity, project, or category. Absent for `ORGANIZATION`. */
    scopeId: idSchema.nullable().optional(),
    entityId: idSchema,
    currency: z.string().length(3),
    periodStart: z.iso.date(),
    periodEnd: z.iso.date(),
    periodGranularity: z.enum(BUDGET_PERIOD_GRANULARITIES).default('MONTHLY'),
    overspendBehavior: z.enum(BUDGET_OVERSPEND_BEHAVIORS).default('WARN'),
    alertThresholds: alertThresholdsSchema.optional(),
    /**
     * The whole allocation, spread evenly across the periods the range
     * produces. Per-period amounts are set afterwards by allocating to a line,
     * because that is the rarer edit and pretending otherwise makes the common
     * case a form with twelve boxes in it.
     */
    totalAllocated: positiveMoneySchema.optional(),
  })
  .refine((value) => value.periodEnd >= value.periodStart, {
    message: 'The period ends before it starts.',
    path: ['periodEnd'],
  })
  .refine(
    (value) => (value.scopeType === 'ORGANIZATION') === (value.scopeId == null),
    {
      message: 'Name what this budget is drawn around, unless it covers the organisation.',
      path: ['scopeId'],
    },
  );

export const updateBudgetSchema = z
  .strictObject({
    name: nonEmptyString(200).optional(),
    overspendBehavior: z.enum(BUDGET_OVERSPEND_BEHAVIORS).optional(),
    alertThresholds: alertThresholdsSchema.optional(),
    status: z.enum(['DRAFT', 'ACTIVE', 'CLOSED']).optional(),
  })
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: 'Supply at least one field to change.',
  });

/**
 * Allocating to one period.
 *
 * Absolute, not a delta. Two people typing "+500" into a form they each opened
 * a minute ago should not produce 1,000 — and the `If-Match` on this route
 * means the second one is told the number moved rather than adding to it.
 */
export const allocateBudgetLineSchema = z.strictObject({
  amount: positiveMoneySchema,
  memo: optionalText(500),
});

export const budgetLineSchema = z.object({
  id: idSchema,
  periodStart: timestampSchema,
  periodEnd: timestampSchema,
  allocated: z.object({ amount: z.string(), currency: z.string() }),
  committed: z.object({ amount: z.string(), currency: z.string() }),
  actual: z.object({ amount: z.string(), currency: z.string() }),
  /** `allocated − committed − actual`. Computed, never stored. */
  remaining: z.object({ amount: z.string(), currency: z.string() }),
  /** Whole percent of allocation consumed. `null` when nothing is allocated. */
  utilization: z.number().nullable(),
  version: versionSchema,
});

export const budgetSchema = z.object({
  id: idSchema,
  name: z.string(),
  scopeType: z.enum(BUDGET_SCOPE_TYPES),
  scopeId: idSchema.nullable(),
  /** Resolved for display, so a list does not need five more requests. */
  scopeName: z.string().nullable(),
  entityId: idSchema,
  currency: z.string(),
  periodStart: timestampSchema,
  periodEnd: timestampSchema,
  periodGranularity: z.enum(BUDGET_PERIOD_GRANULARITIES),
  overspendBehavior: z.enum(BUDGET_OVERSPEND_BEHAVIORS),
  alertThresholds: z.array(z.int()),
  status: z.enum(BUDGET_STATUSES),
  /** Every line summed, which is what a list row shows. */
  totals: z.object({
    allocated: z.object({ amount: z.string(), currency: z.string() }),
    committed: z.object({ amount: z.string(), currency: z.string() }),
    actual: z.object({ amount: z.string(), currency: z.string() }),
    remaining: z.object({ amount: z.string(), currency: z.string() }),
    utilization: z.number().nullable(),
  }),
  createdAt: timestampSchema,
  version: versionSchema,
});

export const budgetDetailSchema = budgetSchema.extend({
  lines: z.array(budgetLineSchema),
});

export const budgetMovementSchema = z.object({
  id: idSchema,
  budgetLineId: idSchema,
  movementType: z.enum(BUDGET_MOVEMENT_TYPES),
  direction: z.enum(BUDGET_MOVEMENT_DIRECTIONS),
  amount: z.object({ amount: z.string(), currency: z.string() }),
  sourceType: z.enum(BUDGET_SOURCE_TYPES),
  sourceId: idSchema,
  actorMembershipId: idSchema.nullable(),
  memo: z.string().nullable(),
  createdAt: timestampSchema,
});

export const listBudgetsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).catch(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).catch(25).default(25),
  status: z.enum(BUDGET_STATUSES).optional(),
  scopeType: z.enum(BUDGET_SCOPE_TYPES).optional(),
  entityId: idSchema.optional(),
  /** Budgets whose period contains this day. */
  asOf: z.iso.date().optional(),
  q: optionalText(200),
});

export const listBudgetMovementsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).catch(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).catch(50).default(50),
  budgetLineId: idSchema.optional(),
});

/**
 * What the policy engine and the spend path are told about a budget.
 *
 * Deliberately small. A caller deciding whether to block spend needs the
 * remaining amount, the utilisation it would reach, and what the budget says
 * to do about an overspend — not the ledger.
 */
export const budgetPositionSchema = z.object({
  budgetId: idSchema,
  budgetLineId: idSchema,
  name: z.string(),
  currency: z.string(),
  allocated: z.string(),
  committed: z.string(),
  actual: z.string(),
  remaining: z.string(),
  utilization: z.number().nullable(),
  overspendBehavior: z.enum(BUDGET_OVERSPEND_BEHAVIORS),
  /** True when the amount asked about would take the line past its allocation. */
  wouldExceed: z.boolean(),
});

export type CreateBudget = z.infer<typeof createBudgetSchema>;
export type UpdateBudget = z.infer<typeof updateBudgetSchema>;
export type AllocateBudgetLine = z.infer<typeof allocateBudgetLineSchema>;
export type BudgetRecord = z.infer<typeof budgetSchema>;
export type BudgetDetail = z.infer<typeof budgetDetailSchema>;
export type BudgetLineRecord = z.infer<typeof budgetLineSchema>;
export type BudgetMovementRecord = z.infer<typeof budgetMovementSchema>;
export type ListBudgetsQuery = z.infer<typeof listBudgetsQuerySchema>;
export type ListBudgetMovementsQuery = z.infer<typeof listBudgetMovementsQuerySchema>;
export type BudgetPosition = z.infer<typeof budgetPositionSchema>;

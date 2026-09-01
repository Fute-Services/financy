/**
 * Administering policies — the CRUD, the draft/publish lifecycle, and the
 * simulator (docs/10 §5.5, tasks 2.1.8 and 2.6).
 *
 * `policy.ts` owns the *rule model* — what a condition may compare and what an
 * outcome may require. This owns the *lifecycle around it*: a policy is
 * created as a draft, its rules are edited freely while it is a draft, and
 * publishing freezes them into an immutable version that evaluation reads.
 *
 * **Editing a policy and publishing it are separate operations**, for the same
 * reason creating and submitting a spend request are. A rule set halfway
 * through being rewritten must not be deciding anybody's spend, and a
 * published version must never change under a decision that cited it — the
 * decision snapshot names `policyVersionIds`, and a mutable version would make
 * "why was this approved?" answerable only with today's rules.
 *
 * **A rule authored here is validated at authoring time, not at evaluation
 * time.** A rule that cannot fire is worse than a rule that is wrong: nothing
 * errors, nothing is logged, and the spend the policy was written to control
 * simply goes through. So `policyRuleSchema` is applied on the way in.
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
import { policyRuleSchema, spendTypeSchema } from './policy.js';
import { policyDecisionSchema } from './spend.js';

export const POLICY_STATUSES = ['DRAFT', 'ACTIVE', 'ARCHIVED'] as const;
export type PolicyStatus = (typeof POLICY_STATUSES)[number];

export const POLICY_STATUS_LABELS: Readonly<Record<PolicyStatus, string>> = {
  DRAFT: 'Draft',
  ACTIVE: 'Active',
  ARCHIVED: 'Archived',
};

export const SPEND_TYPE_LABELS: Readonly<Record<string, string>> = {
  CARD: 'Card spend',
  REIMBURSEMENT: 'Reimbursement',
  BILL: 'Bill',
  PURCHASE_ORDER: 'Purchase order',
  SPEND_REQUEST: 'Spend request',
};

/**
 * A rule as the editor submits it.
 *
 * The id is optional on the way in and always present on the way out. The
 * editor creates rules that have never been stored and has no id to give them;
 * the server mints one, and from then on the same id follows the rule through
 * every version — which is what lets a decision's `matchedRuleIds` be traced
 * back to a rule that has since been edited.
 */
export const policyRuleInputSchema = policyRuleSchema.extend({
  id: idSchema.optional(),
});

export const createPolicySchema = z.strictObject({
  name: nonEmptyString(200),
  description: optionalText(1000),
  /**
   * Never defaulted to every spend type. A policy that applied to everything
   * by omission is a policy nobody meant to write — and the one that blocks
   * an entire organisation's spend the day it is saved.
   */
  spendTypes: z.array(spendTypeSchema).min(1),
  priority: z.int().min(0).max(1000).default(100),
  effectiveFrom: timestampSchema.nullable().optional(),
  effectiveTo: timestampSchema.nullable().optional(),
});

export const updatePolicySchema = z
  .strictObject({
    name: nonEmptyString(200).optional(),
    description: z.string().trim().max(1000).nullable().optional(),
    spendTypes: z.array(spendTypeSchema).min(1).optional(),
    priority: z.int().min(0).max(1000).optional(),
    effectiveFrom: timestampSchema.nullable().optional(),
    effectiveTo: timestampSchema.nullable().optional(),
  })
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: 'Supply at least one field to change.',
  });

/**
 * Replace the draft version's rules wholesale.
 *
 * Wholesale rather than per-rule, because the rule set is ordered and rules
 * interact — a `terminal` rule at sequence 2 decides whether sequence 3 ever
 * runs. Patching one rule at a time would let two editors each save a
 * coherent change and produce an incoherent set between them.
 */
export const savePolicyRulesSchema = z.strictObject({
  rules: z.array(policyRuleInputSchema).max(200),
});

/**
 * Publishing takes a note, and the note is not decoration.
 *
 * It is the only free-text record of *why* the rules changed, it is written
 * into the audit trail, and it is what a reviewer reads six months later when
 * a decision cites this version.
 */
export const publishPolicySchema = z.strictObject({
  note: optionalText(500),
});

export const policyVersionSummarySchema = z.object({
  id: idSchema,
  version: z.int().min(1),
  ruleCount: z.int().min(0),
  publishedAt: timestampSchema.nullable(),
  createdAt: timestampSchema,
  createdBy: z.string().nullable(),
  note: z.string().nullable(),
});

export const policySummarySchema = z.object({
  id: idSchema,
  name: nonEmptyString(200),
  description: z.string().nullable(),
  spendTypes: z.array(spendTypeSchema),
  priority: z.int(),
  status: z.enum(POLICY_STATUSES),
  /** The published version's number. Null while the policy has only a draft. */
  currentVersion: z.int().nullable(),
  /** Whether the draft differs from what is published. */
  hasUnpublishedChanges: z.boolean(),
  ruleCount: z.int().min(0),
  effectiveFrom: timestampSchema.nullable(),
  effectiveTo: timestampSchema.nullable(),
  updatedAt: timestampSchema,
  version: versionSchema,
});

export const policyDetailSchema = policySummarySchema.extend({
  /** The editable rules — the draft's, or the published set if none is open. */
  rules: z.array(policyRuleSchema),
  /** What evaluation is using right now. Empty until something is published. */
  publishedRules: z.array(policyRuleSchema),
  versions: z.array(policyVersionSummarySchema),
});

/**
 * `POST /v1/policies/simulate` — what would happen, without anything happening.
 *
 * The whole point of the evaluator being pure. The simulator supplies a
 * context and gets the decision the real path would have produced, with no
 * spend request created, nothing audited as spend, and no approval chain
 * opened.
 *
 * `at` exists because policies have effective windows and rules can name the
 * fiscal period: "what would this have done in March" is the question a
 * finance lead actually asks before changing a limit.
 */
export const simulatePolicySchema = z.strictObject({
  spendType: spendTypeSchema.default('SPEND_REQUEST'),
  amount: positiveMoneySchema,
  entityId: idSchema,
  /** Whose request to simulate. Defaults to the caller's own membership. */
  requesterMembershipId: idSchema.optional(),
  departmentId: idSchema.nullable().optional(),
  projectId: idSchema.nullable().optional(),
  categoryId: idSchema.nullable().optional(),
  memo: z.string().trim().max(2000).nullable().optional(),
  hasReceipt: z.boolean().default(false),
  neededBy: z.iso.date().nullable().optional(),
  at: timestampSchema.optional(),
  /**
   * Simulate against a policy's *draft* rules rather than its published ones.
   *
   * The reason the simulator exists. Publishing to find out what a rule does
   * is how an organisation discovers a mistake by blocking its own payroll.
   */
  includeDraftOfPolicyId: idSchema.optional(),
});

export const simulationResultSchema = z.object({
  decision: policyDecisionSchema,
  /** What the evaluator was given — shown so a surprising verdict is explicable. */
  context: z.object({
    requester: z.object({
      membershipId: idSchema,
      fullName: z.string(),
      roleKey: z.string(),
      departmentPath: z.string(),
      tenureDays: z.int(),
    }),
    amountInBaseCurrency: z.object({ amount: z.string(), currency: z.string() }),
    fiscalPeriod: z.string(),
    evaluatedAt: timestampSchema,
  }),
  /** Every policy considered, and whether any of its rules matched. */
  policiesConsidered: z.array(
    z.object({
      policyId: idSchema,
      policyVersionId: idSchema,
      name: z.string(),
      priority: z.int(),
      isDraft: z.boolean(),
      matched: z.boolean(),
    }),
  ),
});

/**
 * Human labels for the closed field set, the operators, and the outcomes.
 *
 * They live beside the contract rather than in the web app because the rule
 * builder is not their only reader: a decision panel explaining *why* a request
 * needs two approvals renders the same field names, and two copies of this
 * table would drift in the direction of whichever one nobody re-reads — which
 * is how "Amount" and "amountInBaseCurrency" end up on the same screen.
 *
 * They are labels, never behaviour. `operatorsForField` in `@financy/core`
 * remains the only authority on what may be compared to what.
 */
export const POLICY_FIELD_LABELS: Readonly<Record<string, string>> = {
  amount: 'Amount',
  amountInBaseCurrency: 'Amount in base currency',
  'budget.remaining': 'Budget remaining',
  'history.requesterSpendThisMonth': "Requester's spend this month",
  'requester.tenureDays': 'Requester tenure (days)',
  'requester.managerChainDepth': 'Manager chain depth',
  'budget.utilizationAfter': 'Budget used after this spend',
  'evidence.memoLength': 'Memo length',
  'temporal.dayOfWeek': 'Day of week (1 = Monday)',
  'temporal.dayOfMonth': 'Day of month',
  'history.similarRequestsLast30Days': 'Similar requests in 30 days',
  currency: 'Currency',
  spendType: 'Spend type',
  'requester.roleKey': "Requester's role",
  'requester.departmentId': "Requester's department",
  'requester.entityId': "Requester's entity",
  'category.id': 'Category',
  'project.id': 'Project',
  'vendor.id': 'Vendor',
  'merchant.name': 'Merchant name',
  'temporal.fiscalPeriod': 'Fiscal period',
  'requester.departmentPath': 'Department (including sub-teams)',
  'category.path': 'Category (including children)',
  'budget.wouldExceed': 'Would exceed budget',
  'budget.exists': 'Has a budget',
  'evidence.hasReceipt': 'Has a receipt',
  'evidence.hasMemo': 'Has a memo',
};

/**
 * Operator labels written as the middle of a sentence.
 *
 * "Amount · is more than · 5,000" reads as a sentence; "Amount · GT · 5000"
 * reads as a database. The rule builder is used by finance leads, not by
 * engineers, and a rule they cannot read back is a rule they cannot check.
 */
export const OPERATOR_LABELS: Readonly<Record<string, string>> = {
  EQ: 'is',
  NEQ: 'is not',
  GT: 'is more than',
  GTE: 'is at least',
  LT: 'is less than',
  LTE: 'is at most',
  BETWEEN: 'is between',
  IN: 'is one of',
  NOT_IN: 'is not one of',
  IS_DESCENDANT_OF: 'is within',
  IS_TRUE: 'is true',
  IS_FALSE: 'is false',
  IS_NULL: 'is not set',
  IS_NOT_NULL: 'is set',
};

export const OUTCOME_LABELS: Readonly<Record<string, string>> = {
  ALLOW: 'Allow',
  BLOCK: 'Block',
  AUTO_APPROVE: 'Approve automatically',
  REQUIRE_APPROVER: 'Require an approver',
  REQUIRE_RECEIPT: 'Require a receipt',
  REQUIRE_MEMO: 'Require a memo',
  REQUIRE_FINANCE_REVIEW: 'Require finance review',
  FLAG_EXCEPTION: 'Flag an exception',
  SET_VALIDITY: 'Set how long approval lasts',
};

export const APPROVER_KIND_LABELS: Readonly<Record<string, string>> = {
  MEMBERSHIP: 'A named person',
  ROLE: 'Anyone with a role',
  DEPARTMENT_HEAD: 'The department head',
  MANAGER_CHAIN: "The requester's manager",
  ENTITY_FINANCE_OWNER: "The entity's finance owner",
  WORKFLOW: 'A named workflow',
};

export const STEP_TYPE_LABELS: Readonly<Record<string, string>> = {
  SINGLE: 'One approver',
  PARALLEL_ANY: 'Any one of them',
  PARALLEL_ALL: 'All of them',
  QUORUM: 'A quorum',
};

export const GROUP_OPERATOR_LABELS: Readonly<Record<string, string>> = {
  ALL: 'Match all of',
  ANY: 'Match any of',
  NONE: 'Match none of',
};

export const VERDICT_LABELS: Readonly<Record<string, string>> = {
  ALLOWED: 'Allowed',
  ALLOWED_WITH_APPROVAL: 'Needs approval',
  AUTO_APPROVED: 'Approved automatically',
  BLOCKED: 'Blocked',
};

export type CreatePolicy = z.infer<typeof createPolicySchema>;
export type UpdatePolicy = z.infer<typeof updatePolicySchema>;
export type SavePolicyRules = z.infer<typeof savePolicyRulesSchema>;
export type PublishPolicy = z.infer<typeof publishPolicySchema>;
export type PolicySummary = z.infer<typeof policySummarySchema>;
export type PolicyDetail = z.infer<typeof policyDetailSchema>;
export type PolicyVersionSummary = z.infer<typeof policyVersionSummarySchema>;
export type SimulatePolicy = z.infer<typeof simulatePolicySchema>;
export type SimulationResult = z.infer<typeof simulationResultSchema>;

/**
 * The policy rule model, as plain types (docs/11 §4).
 *
 * **These live in `core`, and their Zod schemas live in `contracts`**, which
 * is the same split `Money` already has: the domain owns the shape and the
 * behaviour, the contract owns the validation and the wire form. The
 * dependency runs contracts → core and cannot run back — `contracts` imports
 * `Money` from here, so an import the other way would be a cycle. Putting the
 * evaluator in `contracts` instead would have put a decision engine inside the
 * package that compiles into the browser bundle.
 *
 * Everything here is data and pure functions over it. Nothing reads a clock,
 * a database, or a request.
 */

// ── Fields ─────────────────────────────────────────────────────────────────

/**
 * The field set is **closed**, and grouped by the type each field holds.
 *
 * A rule names `requester.departmentPath`, not an arbitrary object path, so a
 * typo is a validation error at authoring time rather than a rule that
 * silently never fires. A policy that never fires is the worst failure this
 * subsystem has: nothing errors, nothing is logged, and the spend it was
 * written to control simply goes through.
 */
export const MONEY_FIELDS = [
  'amount',
  'amountInBaseCurrency',
  'budget.remaining',
  'history.requesterSpendThisMonth',
] as const;

export const NUMBER_FIELDS = [
  'requester.tenureDays',
  'requester.managerChainDepth',
  'budget.utilizationAfter',
  'evidence.memoLength',
  'temporal.dayOfWeek',
  'temporal.dayOfMonth',
  'history.similarRequestsLast30Days',
] as const;

export const STRING_FIELDS = [
  'currency',
  'spendType',
  'requester.roleKey',
  'requester.departmentId',
  'requester.entityId',
  'category.id',
  'project.id',
  'vendor.id',
  'merchant.name',
  'temporal.fiscalPeriod',
] as const;

/**
 * Tree fields, which additionally support `IS_DESCENDANT_OF`.
 *
 * That operator is what makes "Engineering and everything under it" a single
 * rule rather than one per sub-department — and, more importantly, a rule that
 * keeps meaning the same thing after somebody adds a team.
 */
export const PATH_FIELDS = ['requester.departmentPath', 'category.path'] as const;

export const BOOLEAN_FIELDS = [
  'budget.wouldExceed',
  'budget.exists',
  'evidence.hasReceipt',
  'evidence.hasMemo',
] as const;

/** Fields that may legitimately be absent, and so accept the null operators. */
export const NULLABLE_FIELDS = [
  'category.id',
  'project.id',
  'vendor.id',
  'merchant.name',
  'requester.departmentId',
] as const;

export const POLICY_FIELDS = [
  ...MONEY_FIELDS,
  ...NUMBER_FIELDS,
  ...STRING_FIELDS,
  ...PATH_FIELDS,
  ...BOOLEAN_FIELDS,
] as const;

export type PolicyField = (typeof POLICY_FIELDS)[number];

// ── Operators ──────────────────────────────────────────────────────────────

export const ORDERED_OPERATORS = ['EQ', 'NEQ', 'GT', 'GTE', 'LT', 'LTE', 'BETWEEN'] as const;
export const SET_OPERATORS = ['EQ', 'NEQ', 'IN', 'NOT_IN'] as const;
export const PATH_OPERATORS = ['EQ', 'IN', 'IS_DESCENDANT_OF'] as const;
export const BOOLEAN_OPERATORS = ['IS_TRUE', 'IS_FALSE'] as const;
export const NULL_OPERATORS = ['IS_NULL', 'IS_NOT_NULL'] as const;

export const COMPARISON_OPERATORS = [
  'EQ',
  'NEQ',
  'GT',
  'GTE',
  'LT',
  'LTE',
  'BETWEEN',
  'IN',
  'NOT_IN',
  'IS_DESCENDANT_OF',
  'IS_TRUE',
  'IS_FALSE',
  'IS_NULL',
  'IS_NOT_NULL',
] as const;

export type ComparisonOperator = (typeof COMPARISON_OPERATORS)[number];

const has = (list: readonly string[], value: string): boolean => list.includes(value);

/**
 * Which operators a field accepts.
 *
 * A lookup rather than a chain of conditionals in the validator, so adding a
 * field is one entry and cannot half-happen: `GT` on a boolean and `IS_TRUE`
 * on an amount are both rejected before storage, because a rule that cannot
 * mean anything should not be storable.
 */
export function operatorsForField(field: PolicyField): readonly ComparisonOperator[] {
  const nullable = has(NULLABLE_FIELDS, field) ? NULL_OPERATORS : [];

  if (has(MONEY_FIELDS, field) || has(NUMBER_FIELDS, field)) {
    return [...ORDERED_OPERATORS, ...nullable];
  }

  if (has(PATH_FIELDS, field)) return [...PATH_OPERATORS, ...nullable];
  if (has(BOOLEAN_FIELDS, field)) return [...BOOLEAN_OPERATORS];

  return [...SET_OPERATORS, ...nullable];
}

/** The value kinds an operator accepts on a given field. */
export function valueKindsFor(
  field: PolicyField,
  operator: ComparisonOperator,
): readonly PolicyValue['kind'][] {
  if (operator === 'IS_TRUE' || operator === 'IS_FALSE') return ['none'];
  if (operator === 'IS_NULL' || operator === 'IS_NOT_NULL') return ['none'];
  if (operator === 'IN' || operator === 'NOT_IN') return ['strings'];

  const isMoney = has(MONEY_FIELDS, field);

  if (operator === 'BETWEEN') return isMoney ? ['moneyRange'] : ['numberRange'];
  if (isMoney) return ['money'];
  if (has(NUMBER_FIELDS, field)) return ['number'];

  return ['string'];
}

// ── Conditions ─────────────────────────────────────────────────────────────

/** A money literal as it travels: decimal string plus currency, never a float. */
export interface MoneyLiteral {
  readonly amount: string;
  readonly currency: string;
}

export type PolicyValue =
  | { readonly kind: 'money'; readonly amount: string; readonly currency: string }
  | { readonly kind: 'number'; readonly value: number }
  | { readonly kind: 'string'; readonly value: string }
  | { readonly kind: 'strings'; readonly value: readonly string[] }
  | { readonly kind: 'moneyRange'; readonly from: MoneyLiteral; readonly to: MoneyLiteral }
  | { readonly kind: 'numberRange'; readonly from: number; readonly to: number }
  /** `IS_TRUE`, `IS_FALSE`, `IS_NULL`, `IS_NOT_NULL` take no operand. */
  | { readonly kind: 'none' };

export interface ComparisonCondition {
  readonly type: 'COMPARISON';
  readonly field: PolicyField;
  readonly operator: ComparisonOperator;
  readonly value: PolicyValue;
}

export const CONDITION_GROUP_OPERATORS = ['ALL', 'ANY', 'NONE'] as const;
export type ConditionGroupOperator = (typeof CONDITION_GROUP_OPERATORS)[number];

export interface ConditionGroup {
  readonly type: 'GROUP';
  readonly operator: ConditionGroupOperator;
  readonly conditions: readonly Condition[];
}

export type Condition = ComparisonCondition | ConditionGroup;

/**
 * Nesting is capped at three levels (docs/11 §4.1).
 *
 * Not an implementation limit — the evaluator recurses happily. It is a
 * comprehensibility limit: a four-deep boolean tree is a rule nobody can read
 * back and confirm, and an unreadable spending policy is one that gets
 * approved without being understood.
 */
export const MAX_CONDITION_DEPTH = 3;

/** Depth of a condition tree, where a bare comparison is 1. */
export function conditionDepth(condition: Condition): number {
  if (condition.type === 'COMPARISON') return 1;

  return 1 + Math.max(...condition.conditions.map(conditionDepth));
}

// ── Outcomes ───────────────────────────────────────────────────────────────

export const STEP_TYPES = ['SINGLE', 'PARALLEL_ANY', 'PARALLEL_ALL', 'QUORUM'] as const;
export type StepType = (typeof STEP_TYPES)[number];

/**
 * How strict each step type is, for merge rule 3.
 *
 * Higher wins when two rules land on the same sequence. `PARALLEL_ALL`
 * (everyone approves) is stricter than `QUORUM` (some do), which is stricter
 * than `PARALLEL_ANY` (one is enough). `SINGLE` is the degenerate case of
 * `PARALLEL_ANY` with one approver and ranks with it.
 */
export const STEP_TYPE_STRICTNESS: Readonly<Record<StepType, number>> = {
  SINGLE: 0,
  PARALLEL_ANY: 0,
  QUORUM: 1,
  PARALLEL_ALL: 2,
};

export const APPROVER_SCOPES = ['ORGANIZATION', 'ENTITY', 'DEPARTMENT'] as const;
export type ApproverScope = (typeof APPROVER_SCOPES)[number];

/**
 * Who must approve, expressed against the organisation graph rather than as a
 * person.
 *
 * A rule says "the requester's manager", not an id that will be wrong after
 * the next reorganisation — and that is also why de-duplication happens on
 * the spec rather than on the resolved person.
 */
export type ApproverSpec =
  | { readonly kind: 'MEMBERSHIP'; readonly membershipId: string }
  | { readonly kind: 'ROLE'; readonly roleKey: string; readonly scope: ApproverScope }
  | { readonly kind: 'DEPARTMENT_HEAD'; readonly levelsUp: number }
  | { readonly kind: 'MANAGER_CHAIN'; readonly position: number }
  | { readonly kind: 'ENTITY_FINANCE_OWNER' }
  | { readonly kind: 'WORKFLOW'; readonly workflowId: string };

/**
 * A stable identity for an approver *specification*, for de-duplication.
 *
 * On the spec rather than on the resolved person, deliberately: two rules that
 * both say "the requester's manager" are one requirement, and they stay one
 * requirement after a reorganisation changes who that is.
 */
export function approverKey(spec: ApproverSpec): string {
  switch (spec.kind) {
    case 'MEMBERSHIP':
      return `MEMBERSHIP:${spec.membershipId}`;
    case 'ROLE':
      return `ROLE:${spec.roleKey}:${spec.scope}`;
    case 'DEPARTMENT_HEAD':
      return `DEPARTMENT_HEAD:${String(spec.levelsUp)}`;
    case 'MANAGER_CHAIN':
      return `MANAGER_CHAIN:${String(spec.position)}`;
    case 'ENTITY_FINANCE_OWNER':
      return 'ENTITY_FINANCE_OWNER';
    case 'WORKFLOW':
      return `WORKFLOW:${spec.workflowId}`;
  }
}

export interface EscalationSpec {
  readonly afterHours: number;
  readonly to: ApproverSpec;
}

export type Outcome =
  | { readonly type: 'ALLOW' }
  | { readonly type: 'BLOCK'; readonly reasonCode: string; readonly message: string }
  | { readonly type: 'AUTO_APPROVE' }
  | {
      readonly type: 'REQUIRE_APPROVER';
      readonly approver: ApproverSpec;
      readonly stepType: StepType;
      readonly sequence: number;
      readonly timeoutHours?: number;
      readonly escalation?: EscalationSpec;
    }
  | { readonly type: 'REQUIRE_RECEIPT' }
  | { readonly type: 'REQUIRE_MEMO'; readonly minLength?: number }
  | { readonly type: 'REQUIRE_FINANCE_REVIEW' }
  | { readonly type: 'FLAG_EXCEPTION'; readonly exceptionCode: string }
  | { readonly type: 'SET_VALIDITY'; readonly days: number };

// ── Rules and policies ─────────────────────────────────────────────────────

export interface PolicyRule {
  readonly id: string;
  readonly name: string;
  /** Rules run in this order within a policy; ties broken by id. */
  readonly sequence: number;
  readonly condition: Condition;
  readonly outcomes: readonly Outcome[];
  /**
   * Stops evaluation of *everything* once this rule matches — not just the
   * rest of its own policy. A terminal rule is how "this is an override,
   * nothing else applies" is expressed, and it is deliberately blunt.
   */
  readonly terminal: boolean;
}

export const SPEND_TYPES = [
  'CARD',
  'REIMBURSEMENT',
  'BILL',
  'PURCHASE_ORDER',
  'SPEND_REQUEST',
] as const;

export type SpendType = (typeof SPEND_TYPES)[number];

export interface PolicyVersion {
  readonly id: string;
  readonly policyId: string;
  readonly version: number;
  readonly spendTypes: readonly SpendType[];
  /** Higher runs first. Ties broken by policy id, never by insertion order. */
  readonly priority: number;
  readonly rules: readonly PolicyRule[];
}

/**
 * Ordering for evaluation (docs/11 §5).
 *
 * Priority descending, then policy id ascending. The tiebreak matters more
 * than it looks: without it, two policies of equal priority would evaluate in
 * whatever order the database happened to return, and the same request could
 * be decided differently on two days with nothing changed.
 */
export function comparePolicyVersions(a: PolicyVersion, b: PolicyVersion): number {
  if (a.priority !== b.priority) return b.priority - a.priority;

  return a.policyId < b.policyId ? -1 : a.policyId > b.policyId ? 1 : 0;
}

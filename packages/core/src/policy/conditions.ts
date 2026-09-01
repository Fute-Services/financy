import { CurrencyMismatchError, Money } from '../money.js';
import type { PolicyContext } from './context.js';
import {
  ORDERED_OPERATORS,
  SET_OPERATORS,
  PATH_OPERATORS,
  type ComparisonCondition,
  type ComparisonOperator,
  type Condition,
  type PolicyField,
} from './rules.js';

/**
 * The operator unions each comparison actually handles.
 *
 * Narrowing before the switch rather than relying on a `default` is what
 * makes each switch exhaustive — so adding an operator to the model is a
 * compile error here rather than a silently unhandled case that evaluates to
 * false. An operator that quietly never matches is exactly the silent-policy
 * failure this file exists to avoid.
 */
type OrderedOperator = (typeof ORDERED_OPERATORS)[number];
type SetOperator = (typeof SET_OPERATORS)[number];
type PathOperator = (typeof PATH_OPERATORS)[number];

const isOrdered = (operator: ComparisonOperator): operator is OrderedOperator =>
  (ORDERED_OPERATORS as readonly string[]).includes(operator);

const isStringOperator = (operator: ComparisonOperator): operator is SetOperator | PathOperator =>
  (SET_OPERATORS as readonly string[]).includes(operator) ||
  (PATH_OPERATORS as readonly string[]).includes(operator);

/**
 * Evaluating a condition tree against a context (docs/11 §4.1).
 *
 * Pure, total, and deliberately unforgiving in one place: **money comparisons
 * are currency-aware.** Comparing 1000 USD to 1000 EUR raises rather than
 * silently comparing magnitudes, because the silent version is a policy that
 * approves a €1,000 purchase under a $1,000 limit and never says why. Rules
 * authored against `amountInBaseCurrency` sidestep the question entirely, and
 * the authoring UI steers there.
 *
 * Everything else is total: a missing field is `null`, `null` compares false
 * against everything except the null operators, and no comparison throws for
 * being about absent data. A policy that errors on an unusual request is a
 * policy that blocks legitimate spend for a reason nobody can act on.
 */

/** What a field holds for one context. `null` means genuinely absent. */
type FieldValue = Money | number | string | boolean | null;

export function evaluateCondition(condition: Condition, context: PolicyContext): boolean {
  if (condition.type === 'GROUP') {
    switch (condition.operator) {
      case 'ALL':
        return condition.conditions.every((child) => evaluateCondition(child, context));
      case 'ANY':
        return condition.conditions.some((child) => evaluateCondition(child, context));
      case 'NONE':
        return !condition.conditions.some((child) => evaluateCondition(child, context));
    }
  }

  return evaluateComparison(condition, context);
}

export function evaluateComparison(
  condition: ComparisonCondition,
  context: PolicyContext,
): boolean {
  const actual = readField(condition.field, context);

  // The null operators are the only ones that mean anything against an absent
  // value, so they are answered before any type dispatch.
  if (condition.operator === 'IS_NULL') return actual === null;
  if (condition.operator === 'IS_NOT_NULL') return actual !== null;

  // Everything else is false against absent data rather than throwing. A
  // request with no category is not a policy error; it is a request with no
  // category, and a rule about categories simply does not apply to it.
  if (actual === null) return false;

  if (typeof actual === 'boolean') {
    return condition.operator === 'IS_TRUE' ? actual : !actual;
  }

  if (actual instanceof Money) return compareMoney(actual, condition);
  if (typeof actual === 'number') return compareNumber(actual, condition);

  return compareString(actual, condition);
}

function compareMoney(actual: Money, condition: ComparisonCondition): boolean {
  const { value, operator } = condition;

  if (!isOrdered(operator)) return false;

  if (operator === 'BETWEEN') {
    if (value.kind !== 'moneyRange') return false;

    const from = Money.of(value.from.amount, value.from.currency);
    const to = Money.of(value.to.amount, value.to.currency);

    // Inclusive at both ends. A limit written "between 100 and 500" that
    // excluded 500 would refuse the request the author meant to allow.
    return guardCurrency(actual, from) && guardCurrency(actual, to)
      ? actual.greaterThanOrEqual(from) && actual.lessThanOrEqual(to)
      : false;
  }

  if (value.kind !== 'money') return false;

  const expected = Money.of(value.amount, value.currency);

  // Raises rather than returning false. A currency mismatch is an authoring
  // mistake, and answering "no match" would hide it behind a policy that
  // simply never fires.
  guardCurrency(actual, expected);

  switch (operator) {
    case 'EQ':
      return actual.equals(expected);
    case 'NEQ':
      return !actual.equals(expected);
    case 'GT':
      return actual.greaterThan(expected);
    case 'GTE':
      return actual.greaterThanOrEqual(expected);
    case 'LT':
      return actual.lessThan(expected);
    case 'LTE':
      return actual.lessThanOrEqual(expected);
  }
}

/**
 * Refuse a cross-currency comparison, loudly.
 *
 * `Money` itself throws on arithmetic across currencies; comparison operators
 * would too, but the message would name the operation rather than the policy
 * problem. Raising here keeps the reason legible in the failure.
 */
function guardCurrency(actual: Money, expected: Money): true {
  if (actual.currency !== expected.currency) {
    throw new CurrencyMismatchError(actual.currency, expected.currency, 'compare');
  }

  return true;
}

function compareNumber(actual: number, condition: ComparisonCondition): boolean {
  const { value, operator } = condition;

  if (!isOrdered(operator)) return false;

  if (operator === 'BETWEEN') {
    return value.kind === 'numberRange' && actual >= value.from && actual <= value.to;
  }

  if (value.kind !== 'number') return false;

  switch (operator) {
    case 'EQ':
      return actual === value.value;
    case 'NEQ':
      return actual !== value.value;
    case 'GT':
      return actual > value.value;
    case 'GTE':
      return actual >= value.value;
    case 'LT':
      return actual < value.value;
    case 'LTE':
      return actual <= value.value;
  }
}

function compareString(actual: string, condition: ComparisonCondition): boolean {
  const { value, operator } = condition;

  if (!isStringOperator(operator)) return false;

  switch (operator) {
    case 'EQ':
      return value.kind === 'string' && actual === value.value;
    case 'NEQ':
      return value.kind === 'string' && actual !== value.value;
    case 'IN':
      return value.kind === 'strings' && value.value.includes(actual);
    case 'NOT_IN':
      return value.kind === 'strings' && !value.value.includes(actual);
    case 'IS_DESCENDANT_OF':
      /**
       * `/a/b/c/` is a descendant of `/a/`, and of itself.
       *
       * Self-inclusion is the useful reading: "Engineering and everything
       * under it" is what an author means by naming Engineering, and a rule
       * that excluded the department itself would be a surprise every time.
       *
       * Both paths are delimited at each end, which is what makes this a
       * prefix test rather than a `startsWith` that would match `/a/bc/` for
       * a query about `/a/b/` — the same trap the department service guards.
       */
      return value.kind === 'string' && actual.startsWith(value.value);
  }
}

/**
 * Read one field out of the context.
 *
 * A switch over the closed field set rather than a path lookup: a typo is
 * already impossible by the time this runs (the schema rejected it), and an
 * exhaustive switch means adding a field to the contract without teaching the
 * evaluator about it is a compile error rather than a rule that never fires.
 */
export function readField(field: PolicyField, context: PolicyContext): FieldValue {
  switch (field) {
    case 'amount':
      return context.amount;
    case 'amountInBaseCurrency':
      return context.amountInBaseCurrency;
    case 'currency':
      return context.amount.currency;
    case 'spendType':
      return context.spendType;

    case 'requester.roleKey':
      return context.requester.roleKey;
    case 'requester.departmentId':
      return context.requester.departmentId;
    case 'requester.departmentPath':
      return context.requester.departmentPath;
    case 'requester.entityId':
      return context.requester.entityId;
    case 'requester.tenureDays':
      return context.requester.tenureDays;
    case 'requester.managerChainDepth':
      return context.requester.managerChain.length;

    case 'category.id':
      return context.classification.categoryId;
    case 'category.path':
      return context.classification.categoryPath;
    case 'project.id':
      return context.classification.projectId;
    case 'vendor.id':
      return context.classification.vendorId;
    case 'merchant.name':
      return context.classification.merchantName;

    case 'budget.remaining':
      return context.budget?.remaining ?? null;
    case 'budget.utilizationAfter':
      return context.budget?.utilizationAfterThisSpend ?? null;
    case 'budget.wouldExceed':
      // `false` rather than `null` when there is no budget: "would this
      // exceed the budget" has an answer even when there is no budget, and
      // it is no.
      return context.budget?.wouldExceed ?? false;
    case 'budget.exists':
      return context.budget !== null;

    case 'evidence.hasReceipt':
      return context.evidence.hasReceipt;
    case 'evidence.hasMemo':
      return context.evidence.hasMemo;
    case 'evidence.memoLength':
      return context.evidence.memoLength;

    case 'temporal.dayOfWeek':
      // UTC, matching every other timestamp in the system. A rule about
      // "weekends" that depended on the server's zone would fire differently
      // after a deploy to another region.
      return context.temporal.now.getUTCDay();
    case 'temporal.dayOfMonth':
      return context.temporal.now.getUTCDate();
    case 'temporal.fiscalPeriod':
      return context.temporal.fiscalPeriod;

    case 'history.requesterSpendThisMonth':
      return context.history.requesterSpendThisMonth;
    case 'history.similarRequestsLast30Days':
      return context.history.similarRequestsLast30Days;
  }
}

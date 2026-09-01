import { describe, expect, it } from 'vitest';

import { CurrencyMismatchError, Money } from '../money.js';
import { evaluateCondition, readField } from './conditions.js';
import type { PolicyContext } from './context.js';
import {
  POLICY_FIELDS,
  operatorsForField,
  type ComparisonOperator,
  type Condition,
  type PolicyField,
  type PolicyValue,
} from './rules.js';

/**
 * The condition evaluator (docs/11 §4.1).
 *
 * Two properties carry most of the weight here.
 *
 * **Totality.** A policy that errors on an unusual request blocks legitimate
 * spend for a reason nobody can act on, so every comparison against absent
 * data answers `false` rather than throwing — with exactly one exception.
 *
 * **That exception: money is currency-aware.** Comparing 1000 USD to 1000 EUR
 * raises, because the alternative is a policy that approves a €1,000 purchase
 * under a $1,000 limit and never says why.
 */

const context = (overrides: Partial<PolicyContext> = {}): PolicyContext => ({
  organizationId: 'org-1',
  spendType: 'SPEND_REQUEST',
  amount: Money.of('250.00', 'USD'),
  amountInBaseCurrency: Money.of('250.00', 'USD'),
  requester: {
    membershipId: 'm-1',
    roleKey: 'EMPLOYEE',
    departmentId: 'dept-eng',
    departmentPath: '/dept-eng/dept-platform/',
    entityId: 'ent-1',
    managerChain: ['m-2', 'm-3'],
    tenureDays: 400,
  },
  classification: {
    categoryId: 'cat-travel',
    categoryPath: '/cat-travel/cat-airfare/',
    projectId: null,
    vendorId: null,
    merchantName: 'Acme Airlines',
  },
  budget: {
    budgetLineId: 'bl-1',
    allocated: Money.of('10000.00', 'USD'),
    committed: Money.of('4000.00', 'USD'),
    actual: Money.of('3000.00', 'USD'),
    remaining: Money.of('3000.00', 'USD'),
    utilizationAfterThisSpend: 0.72,
    wouldExceed: false,
  },
  evidence: { hasReceipt: true, hasMemo: false, memoLength: 0, receiptCount: 1 },
  temporal: {
    // A Wednesday, so `dayOfWeek` assertions are stable.
    now: new Date('2026-09-02T10:00:00.000Z'),
    neededBy: null,
    fiscalPeriod: '2026-Q3',
  },
  history: {
    requesterSpendThisMonth: Money.of('1200.00', 'USD'),
    requesterSpendThisMonthInCategory: Money.of('600.00', 'USD'),
    similarRequestsLast30Days: 2,
  },
  ...overrides,
});

/**
 * A comparison, built without the schema.
 *
 * The tests below deliberately construct combinations the contract's
 * validator would reject — an operator on the wrong field type, a value of
 * the wrong kind — because the evaluator has to be total against whatever
 * reaches it. Validation is the schema's job and is tested there; this suite
 * is about what the evaluator does when something slips past.
 */
const compare = (
  field: PolicyField,
  operator: ComparisonOperator,
  value: PolicyValue,
): Condition => ({ type: 'COMPARISON', field, operator, value });

describe('every field is readable', () => {
  /**
   * A field the contract names but the evaluator cannot read would be a rule
   * that silently never fires — the worst failure this subsystem has. The
   * exhaustive switch makes it a compile error; this makes it a test failure
   * too, because a `default` added in a hurry would defeat the compiler.
   */
  it.each(POLICY_FIELDS)('reads %s without throwing', (field) => {
    expect(() => readField(field, context())).not.toThrow();
  });

  it('every field has at least one usable operator', () => {
    for (const field of POLICY_FIELDS) {
      expect(operatorsForField(field).length).toBeGreaterThan(0);
    }
  });
});

describe('money comparisons', () => {
  it('compares within one currency', () => {
    expect(
      evaluateCondition(
        compare('amount', 'GT', { kind: 'money', amount: '100.00', currency: 'USD' }),
        context(),
      ),
    ).toBe(true);
  });

  /**
   * The one place the evaluator refuses to answer. Silently comparing
   * magnitudes across currencies is how a €1,000 purchase passes a $1,000
   * limit, and nothing in the decision would say why.
   */
  it('raises rather than comparing magnitudes across currencies', () => {
    expect(() =>
      evaluateCondition(
        compare('amount', 'GT', { kind: 'money', amount: '100.00', currency: 'EUR' }),
        context(),
      ),
    ).toThrow(CurrencyMismatchError);
  });

  it('treats BETWEEN as inclusive at both ends', () => {
    const between = (from: string, to: string): boolean =>
      evaluateCondition(
        compare('amount', 'BETWEEN', {
          kind: 'moneyRange',
          from: { amount: from, currency: 'USD' },
          to: { amount: to, currency: 'USD' },
        }),
        context(),
      );

    // A limit written "between 100 and 250" that excluded 250 would refuse
    // the request its author meant to allow.
    expect(between('250.00', '500.00')).toBe(true);
    expect(between('100.00', '250.00')).toBe(true);
    expect(between('251.00', '500.00')).toBe(false);
  });
});

describe('path comparisons', () => {
  it('matches a department and everything under it', () => {
    expect(
      evaluateCondition(
        compare('requester.departmentPath', 'IS_DESCENDANT_OF', {
          kind: 'string',
          value: '/dept-eng/',
        }),
        context(),
      ),
    ).toBe(true);
  });

  it('counts a department as a descendant of itself', () => {
    // "Engineering and everything under it" is what an author means by naming
    // Engineering; excluding the department itself would surprise every time.
    expect(
      evaluateCondition(
        compare('requester.departmentPath', 'IS_DESCENDANT_OF', {
          kind: 'string',
          value: '/dept-eng/dept-platform/',
        }),
        context(),
      ),
    ).toBe(true);
  });

  /**
   * The delimiter trap, asserted rather than assumed. Without the trailing
   * slash on both paths, `/dept-engineering/` would match a rule about
   * `/dept-eng/` and quietly widen the rule to a department nobody named.
   */
  it('does not match a sibling whose id merely starts the same way', () => {
    const sibling = context({
      requester: { ...context().requester, departmentPath: '/dept-engineering/' },
    });

    expect(
      evaluateCondition(
        compare('requester.departmentPath', 'IS_DESCENDANT_OF', {
          kind: 'string',
          value: '/dept-eng/',
        }),
        sibling,
      ),
    ).toBe(false);
  });
});

describe('absent data', () => {
  const withoutCategory = context({
    classification: { ...context().classification, categoryId: null },
  });

  it('answers IS_NULL truthfully', () => {
    expect(
      evaluateCondition(compare('category.id', 'IS_NULL', { kind: 'none' }), withoutCategory),
    ).toBe(true);
  });

  /**
   * A request with no category is not a policy error; it is a request with no
   * category, and a rule about categories does not apply to it.
   */
  it('answers false — not an error — for every other operator', () => {
    expect(
      evaluateCondition(
        compare('category.id', 'EQ', { kind: 'string', value: 'cat-travel' }),
        withoutCategory,
      ),
    ).toBe(false);

    expect(
      evaluateCondition(
        compare('category.id', 'NEQ', { kind: 'string', value: 'cat-travel' }),
        withoutCategory,
      ),
    ).toBe(false);
  });

  /**
   * `budget.wouldExceed` is the deliberate exception to "absent means null":
   * "would this exceed the budget" has an answer even when there is no
   * budget, and the answer is no.
   */
  it('answers budget.wouldExceed as false when there is no budget at all', () => {
    const noBudget = context({ budget: null });

    expect(
      evaluateCondition(compare('budget.wouldExceed', 'IS_FALSE', { kind: 'none' }), noBudget),
    ).toBe(true);
    expect(
      evaluateCondition(compare('budget.exists', 'IS_FALSE', { kind: 'none' }), noBudget),
    ).toBe(true);
  });
});

describe('groups', () => {
  const matches = compare('requester.roleKey', 'EQ', { kind: 'string', value: 'EMPLOYEE' });
  const fails = compare('requester.roleKey', 'EQ', { kind: 'string', value: 'ORG_ADMIN' });

  it.each([
    ['ALL', [matches, matches], true],
    ['ALL', [matches, fails], false],
    ['ANY', [fails, matches], true],
    ['ANY', [fails, fails], false],
    ['NONE', [fails, fails], true],
    ['NONE', [fails, matches], false],
  ] as const)('%s over %i conditions is %s', (operator, conditions, expected) => {
    expect(
      evaluateCondition({ type: 'GROUP', operator, conditions: [...conditions] }, context()),
    ).toBe(expected);
  });

  it('nests to the documented depth', () => {
    const nested: Condition = {
      type: 'GROUP',
      operator: 'ALL',
      conditions: [
        { type: 'GROUP', operator: 'ANY', conditions: [fails, matches] },
        { type: 'GROUP', operator: 'NONE', conditions: [fails] },
      ],
    };

    expect(evaluateCondition(nested, context())).toBe(true);
  });
});

describe('temporal fields', () => {
  /**
   * UTC, matching every other timestamp in the system. A rule about weekends
   * that depended on the server's zone would fire differently after a deploy
   * to another region — and nobody would connect the two.
   */
  it('reads the day from the injected clock in UTC', () => {
    const lateOnATuesdayUtc = context({
      temporal: { ...context().temporal, now: new Date('2026-09-01T23:30:00.000Z') },
    });

    expect(readField('temporal.dayOfWeek', lateOnATuesdayUtc)).toBe(2);
    expect(readField('temporal.dayOfMonth', lateOnATuesdayUtc)).toBe(1);
  });
});

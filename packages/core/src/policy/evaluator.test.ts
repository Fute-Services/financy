import { describe, expect, it } from 'vitest';

import { Money } from '../money.js';
import type { PolicyContext } from './context.js';
import { POLICY_ENGINE_VERSION, evaluate } from './evaluator.js';
import type { Condition, Outcome, PolicyRule, PolicyVersion } from './rules.js';

/**
 * The evaluator (docs/11 §5).
 *
 * The properties worth testing here are not "does a rule fire" — the
 * condition suite covers that — but the ones that decide whether two
 * identical requests get identical answers:
 *
 * - **Ordering is total and deterministic.** Priority, then policy id. Without
 *   the tiebreak, two policies of equal priority evaluate in whatever order
 *   the database returned them, and the same request is decided differently on
 *   two days with nothing changed.
 * - **Terminal rules and blocks stop everything**, not just their own policy.
 * - **The decision records what produced it**, including the engine version —
 *   so a decision made under one set of merge semantics stays interpretable
 *   after they change.
 */

const context = (amount = '250.00'): PolicyContext => ({
  organizationId: 'org-1',
  spendType: 'SPEND_REQUEST',
  amount: Money.of(amount, 'USD'),
  amountInBaseCurrency: Money.of(amount, 'USD'),
  requester: {
    membershipId: 'm-1',
    roleKey: 'EMPLOYEE',
    departmentId: 'dept-eng',
    departmentPath: '/dept-eng/',
    entityId: 'ent-1',
    managerChain: ['m-2'],
    tenureDays: 400,
  },
  classification: {
    categoryId: 'cat-travel',
    categoryPath: '/cat-travel/',
    projectId: null,
    vendorId: null,
    merchantName: null,
  },
  budget: null,
  evidence: { hasReceipt: false, hasMemo: false, memoLength: 0, receiptCount: 0 },
  temporal: { now: new Date('2026-09-02T10:00:00.000Z'), neededBy: null, fiscalPeriod: '2026-Q3' },
  history: {
    requesterSpendThisMonth: Money.of('0.00', 'USD'),
    requesterSpendThisMonthInCategory: Money.of('0.00', 'USD'),
    similarRequestsLast30Days: 0,
  },
});

const always: Condition = {
  type: 'COMPARISON',
  field: 'spendType',
  operator: 'EQ',
  value: { kind: 'string', value: 'SPEND_REQUEST' },
};

const never: Condition = {
  type: 'COMPARISON',
  field: 'spendType',
  operator: 'EQ',
  value: { kind: 'string', value: 'CARD' },
};

const rule = (
  id: string,
  outcomes: Outcome[],
  overrides: Partial<PolicyRule> = {},
): PolicyRule => ({
  id,
  name: id,
  sequence: 1,
  condition: always,
  outcomes,
  terminal: false,
  ...overrides,
});

const policy = (
  id: string,
  rules: PolicyRule[],
  overrides: Partial<PolicyVersion> = {},
): PolicyVersion => ({
  id: `${id}-v1`,
  policyId: id,
  version: 1,
  spendTypes: ['SPEND_REQUEST'],
  priority: 100,
  rules,
  ...overrides,
});

describe('applicability', () => {
  it('ignores a policy that does not cover this spend type', () => {
    const decision = evaluate(context(), [
      policy('p1', [rule('r1', [{ type: 'BLOCK', reasonCode: 'X', message: 'no' }])], {
        spendTypes: ['CARD'],
      }),
    ]);

    expect(decision.verdict).toBe('ALLOWED');
    expect(decision.evaluation.policyVersionIds).toEqual([]);
  });

  it('ignores a rule whose condition does not match', () => {
    const decision = evaluate(context(), [
      policy('p1', [rule('r1', [{ type: 'REQUIRE_RECEIPT' }], { condition: never })]),
    ]);

    expect(decision.requirements.requireReceipt).toBe(false);
    expect(decision.evaluation.matchedRuleIds).toEqual([]);
  });
});

describe('ordering is deterministic', () => {
  /**
   * The property that stops the same request being decided differently on two
   * days. Two policies of equal priority must evaluate in a fixed order, and
   * the fixed order is by policy id — not by whatever the database returned.
   */
  it('evaluates equal-priority policies by policy id, whatever order they arrive in', () => {
    const a = policy('aaa', [rule('rule-a', [{ type: 'FLAG_EXCEPTION', exceptionCode: 'A' }])]);
    const b = policy('bbb', [rule('rule-b', [{ type: 'FLAG_EXCEPTION', exceptionCode: 'B' }])]);

    const forwards = evaluate(context(), [a, b]);
    const backwards = evaluate(context(), [b, a]);

    expect(forwards.evaluation.matchedRuleIds).toEqual(['rule-a', 'rule-b']);
    expect(backwards.evaluation.matchedRuleIds).toEqual(['rule-a', 'rule-b']);
  });

  it('runs higher priority first regardless of id', () => {
    const low = policy(
      'aaa',
      [rule('rule-low', [{ type: 'FLAG_EXCEPTION', exceptionCode: 'L' }])],
      {
        priority: 1,
      },
    );
    const high = policy(
      'zzz',
      [rule('rule-high', [{ type: 'FLAG_EXCEPTION', exceptionCode: 'H' }])],
      {
        priority: 900,
      },
    );

    expect(evaluate(context(), [low, high]).evaluation.matchedRuleIds).toEqual([
      'rule-high',
      'rule-low',
    ]);
  });

  it('runs rules within a policy by sequence, then id', () => {
    const decision = evaluate(context(), [
      policy('p1', [
        rule('r-second', [{ type: 'FLAG_EXCEPTION', exceptionCode: '2' }], { sequence: 2 }),
        rule('r-first', [{ type: 'FLAG_EXCEPTION', exceptionCode: '1' }], { sequence: 1 }),
      ]),
    ]);

    expect(decision.evaluation.matchedRuleIds).toEqual(['r-first', 'r-second']);
  });
});

describe('stopping', () => {
  /**
   * A terminal rule stops **everything**, not just the rest of its own
   * policy. It is the blunt "this is an override, nothing else applies" that
   * an emergency needs to be expressible without editing every policy.
   */
  it('stops every remaining policy once a terminal rule matches', () => {
    const first = policy(
      'aaa',
      [rule('terminal', [{ type: 'AUTO_APPROVE' }], { terminal: true })],
      { priority: 900 },
    );
    const second = policy('bbb', [rule('later', [{ type: 'REQUIRE_RECEIPT' }])], { priority: 1 });

    const decision = evaluate(context(), [first, second]);

    expect(decision.evaluation.matchedRuleIds).toEqual(['terminal']);
    expect(decision.requirements.requireReceipt).toBe(false);
  });

  it('stops on a BLOCK without needing the rule to be marked terminal', () => {
    const first = policy(
      'aaa',
      [rule('blocker', [{ type: 'BLOCK', reasonCode: 'NO', message: 'Refused.' }])],
      { priority: 900 },
    );
    const second = policy('bbb', [rule('later', [{ type: 'REQUIRE_RECEIPT' }])], { priority: 1 });

    const decision = evaluate(context(), [first, second]);

    expect(decision.verdict).toBe('BLOCKED');
    expect(decision.evaluation.matchedRuleIds).toEqual(['blocker']);
  });
});

describe('the default outcome', () => {
  /**
   * An organisation with no policy still needs an answer, and it is a
   * configuration decision rather than a hardcoded one. Allowing is the
   * default default: a fresh organisation that blocks its own first purchase
   * is a product nobody gets past.
   */
  it('allows when nothing matched and no default was supplied', () => {
    expect(evaluate(context(), []).verdict).toBe('ALLOWED');
  });

  it('applies the organisation default when nothing matched', () => {
    const decision = evaluate(context(), [], {
      defaultOutcomes: [
        {
          type: 'REQUIRE_APPROVER',
          approver: { kind: 'MANAGER_CHAIN', position: 1 },
          stepType: 'SINGLE',
          sequence: 1,
        },
      ],
    });

    expect(decision.verdict).toBe('ALLOWED_WITH_APPROVAL');
  });

  /**
   * The default is recorded as matching no rules, which is the truth — a
   * reader of the decision should be able to see it came from the default
   * rather than from a policy nobody can find.
   */
  it('records that no rule matched', () => {
    const decision = evaluate(context(), [], { defaultOutcomes: [{ type: 'REQUIRE_RECEIPT' }] });

    expect(decision.evaluation.matchedRuleIds).toEqual([]);
    expect(decision.evaluation.policyVersionIds).toEqual([]);
    expect(decision.requirements.requireReceipt).toBe(true);
  });
});

describe('the decision snapshot', () => {
  it('records the engine version, so old decisions stay interpretable', () => {
    // Without it, a "why was this approved?" screen would explain the past
    // using today's merge semantics and quietly be wrong.
    expect(evaluate(context(), []).evaluation.engineVersion).toBe(POLICY_ENGINE_VERSION);
  });

  it('takes its timestamp from the injected clock, not the wall clock', () => {
    const decision = evaluate(context(), []);

    expect(decision.evaluation.evaluatedAt).toBe('2026-09-02T10:00:00.000Z');
  });

  it('is identical for two identical calls', () => {
    const policies = [
      policy('p1', [
        rule('r1', [
          {
            type: 'REQUIRE_APPROVER',
            approver: { kind: 'MANAGER_CHAIN', position: 1 },
            stepType: 'SINGLE',
            sequence: 1,
          },
        ]),
      ]),
    ];

    // Purity, asserted. A duration read from a clock inside the evaluator
    // would break this and every golden-file test with it.
    expect(evaluate(context(), policies)).toEqual(evaluate(context(), policies));
  });

  it('names each contributing policy version once', () => {
    const decision = evaluate(context(), [
      policy('p1', [
        rule('r1', [{ type: 'FLAG_EXCEPTION', exceptionCode: 'A' }]),
        rule('r2', [{ type: 'FLAG_EXCEPTION', exceptionCode: 'B' }], { sequence: 2 }),
      ]),
    ]);

    expect(decision.evaluation.policyVersionIds).toEqual(['p1-v1']);
    expect(decision.evaluation.matchedRuleIds).toEqual(['r1', 'r2']);
  });
});

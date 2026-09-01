import { describe, expect, it } from 'vitest';

import { mergeOutcomes, type AttributedOutcome } from './merge.js';
import type { ApproverSpec, Outcome } from './rules.js';

/**
 * The nine precedence rules (docs/11 §5.1), one test each, every one built
 * around an **explicitly constructed conflict**.
 *
 * This is the part of the engine that must be unambiguous. Multiple rules
 * across multiple policies can fire on one request, and ambiguity in how their
 * outcomes combine means the same request is approved differently on two days
 * — which destroys trust in a spending control faster than any outright bug,
 * because it looks like favouritism rather than a defect.
 *
 * Each test therefore contains two outcomes that disagree, not one outcome
 * checked for passing through. A merge that happens to be right for a single
 * outcome tells you nothing about what it does with a conflict.
 */

const from = (...outcomes: Outcome[]): AttributedOutcome[] =>
  outcomes.map((outcome, index) => ({ outcome, ruleId: `rule-${String(index + 1)}` }));

const manager: ApproverSpec = { kind: 'MANAGER_CHAIN', position: 1 };
const financeRole: ApproverSpec = { kind: 'ROLE', roleKey: 'FINANCE_ADMIN', scope: 'ORGANIZATION' };

describe('merge rule 1 — BLOCK dominates', () => {
  it('blocks even when another rule allowed and a third auto-approved', () => {
    const merged = mergeOutcomes(
      from(
        { type: 'ALLOW' },
        { type: 'AUTO_APPROVE' },
        { type: 'BLOCK', reasonCode: 'NO_BUDGET', message: 'No budget line covers this.' },
      ),
    );

    expect(merged.verdict).toBe('BLOCKED');
  });

  /**
   * Every reason, not just the first. Somebody refused for three reasons
   * should be able to fix all three at once rather than discovering them one
   * submission at a time.
   */
  it('returns every blocking reason with the rule that produced it', () => {
    const merged = mergeOutcomes(
      from(
        { type: 'BLOCK', reasonCode: 'NO_RECEIPT', message: 'A receipt is required.' },
        { type: 'BLOCK', reasonCode: 'OVER_LIMIT', message: 'Above your limit.' },
      ),
    );

    expect(merged.blocks.map((block) => block.reasonCode)).toEqual(['NO_RECEIPT', 'OVER_LIMIT']);
    expect(merged.blocks.map((block) => block.ruleId)).toEqual(['rule-1', 'rule-2']);
  });
});

describe('merge rule 2 — approvers union and de-duplicate', () => {
  /**
   * De-duplication is on the *specification*, not on a resolved person. Two
   * rules that both say "the requester's manager" are one requirement, and
   * stay one after a reorganisation changes who that is.
   */
  it('collapses two rules asking for the same approver spec into one', () => {
    const merged = mergeOutcomes(
      from(
        { type: 'REQUIRE_APPROVER', approver: manager, stepType: 'SINGLE', sequence: 1 },
        { type: 'REQUIRE_APPROVER', approver: { ...manager }, stepType: 'SINGLE', sequence: 1 },
      ),
    );

    expect(merged.requirements.approvalSteps).toHaveLength(1);
    expect(merged.requirements.approvalSteps[0]?.approvers).toHaveLength(1);
  });

  it('keeps genuinely different approvers on the same step', () => {
    const merged = mergeOutcomes(
      from(
        { type: 'REQUIRE_APPROVER', approver: manager, stepType: 'PARALLEL_ALL', sequence: 1 },
        { type: 'REQUIRE_APPROVER', approver: financeRole, stepType: 'PARALLEL_ALL', sequence: 1 },
      ),
    );

    expect(merged.requirements.approvalSteps[0]?.approvers).toHaveLength(2);
  });
});

describe('merge rule 3 — sequence groups become steps, strictest type wins', () => {
  it('makes one step per sequence, ordered by sequence', () => {
    const merged = mergeOutcomes(
      from(
        { type: 'REQUIRE_APPROVER', approver: financeRole, stepType: 'SINGLE', sequence: 2 },
        { type: 'REQUIRE_APPROVER', approver: manager, stepType: 'SINGLE', sequence: 1 },
      ),
    );

    // Sorted by sequence, not by the order the rules happened to fire — the
    // steps come out in the order they will run.
    expect(merged.requirements.approvalSteps.map((step) => step.sequence)).toEqual([1, 2]);
  });

  it.each([
    ['PARALLEL_ANY', 'QUORUM', 'QUORUM'],
    ['QUORUM', 'PARALLEL_ALL', 'PARALLEL_ALL'],
    ['PARALLEL_ANY', 'PARALLEL_ALL', 'PARALLEL_ALL'],
    // `SINGLE` ranks with `PARALLEL_ANY` — it is the degenerate case of one
    // approver — so the stricter of the pair still wins.
    ['SINGLE', 'QUORUM', 'QUORUM'],
  ] as const)('%s combined with %s becomes %s', (first, second, expected) => {
    const merged = mergeOutcomes(
      from(
        { type: 'REQUIRE_APPROVER', approver: manager, stepType: first, sequence: 1 },
        { type: 'REQUIRE_APPROVER', approver: financeRole, stepType: second, sequence: 1 },
      ),
    );

    expect(merged.requirements.approvalSteps[0]?.stepType).toBe(expected);
  });

  it('is not sensitive to the order the two rules fired in', () => {
    const forwards = mergeOutcomes(
      from(
        { type: 'REQUIRE_APPROVER', approver: manager, stepType: 'PARALLEL_ALL', sequence: 1 },
        { type: 'REQUIRE_APPROVER', approver: financeRole, stepType: 'PARALLEL_ANY', sequence: 1 },
      ),
    );

    const backwards = mergeOutcomes(
      from(
        { type: 'REQUIRE_APPROVER', approver: financeRole, stepType: 'PARALLEL_ANY', sequence: 1 },
        { type: 'REQUIRE_APPROVER', approver: manager, stepType: 'PARALLEL_ALL', sequence: 1 },
      ),
    );

    expect(forwards.requirements.approvalSteps[0]?.stepType).toBe(
      backwards.requirements.approvalSteps[0]?.stepType,
    );
  });
});

describe('merge rule 4 — evidence: strictest wins', () => {
  it('requires a receipt if any rule does', () => {
    const merged = mergeOutcomes(from({ type: 'ALLOW' }, { type: 'REQUIRE_RECEIPT' }));

    expect(merged.requirements.requireReceipt).toBe(true);
  });

  it('takes the longest minimum memo length', () => {
    const merged = mergeOutcomes(
      from(
        { type: 'REQUIRE_MEMO', minLength: 20 },
        { type: 'REQUIRE_MEMO', minLength: 100 },
        { type: 'REQUIRE_MEMO', minLength: 50 },
      ),
    );

    expect(merged.requirements.requireMemo).toEqual({ required: true, minLength: 100 });
  });

  /**
   * A rule that requires a memo without saying how long still requires one.
   * Treating its absent minimum as zero must not lower another rule's floor.
   */
  it('does not let a memo rule without a minimum lower another rule’s floor', () => {
    const merged = mergeOutcomes(
      from({ type: 'REQUIRE_MEMO', minLength: 80 }, { type: 'REQUIRE_MEMO' }),
    );

    expect(merged.requirements.requireMemo).toEqual({ required: true, minLength: 80 });
  });
});

describe('merge rule 5 — AUTO_APPROVE is conditional', () => {
  it('auto-approves when nothing required an approver', () => {
    const merged = mergeOutcomes(from({ type: 'AUTO_APPROVE' }, { type: 'REQUIRE_RECEIPT' }));

    expect(merged.verdict).toBe('AUTO_APPROVED');
  });

  /**
   * The conflict that matters. A rule asking for a human was written by
   * somebody who wanted one, and an auto-approval elsewhere must not quietly
   * remove them.
   */
  it('does not auto-approve when any rule required an approver', () => {
    const merged = mergeOutcomes(
      from(
        { type: 'AUTO_APPROVE' },
        { type: 'REQUIRE_APPROVER', approver: manager, stepType: 'SINGLE', sequence: 1 },
      ),
    );

    expect(merged.verdict).toBe('ALLOWED_WITH_APPROVAL');
    expect(merged.requirements.approvalSteps).toHaveLength(1);
  });
});

describe('merge rule 6 — finance review is sticky', () => {
  it('stays required once any rule asked for it', () => {
    const merged = mergeOutcomes(
      from({ type: 'REQUIRE_FINANCE_REVIEW' }, { type: 'ALLOW' }, { type: 'AUTO_APPROVE' }),
    );

    expect(merged.requirements.requireFinanceReview).toBe(true);
  });

  /**
   * There is deliberately no outcome that clears it. This test exists to fail
   * loudly if one is ever added: a rule that could switch finance review off
   * would let a low-priority policy quietly disable a control a high-priority
   * one imposed.
   */
  it('has no outcome capable of clearing it', () => {
    const clearing = (['ALLOW', 'AUTO_APPROVE', 'REQUIRE_RECEIPT'] as const).map((type) =>
      mergeOutcomes(from({ type: 'REQUIRE_FINANCE_REVIEW' }, { type })),
    );

    expect(clearing.every((merged) => merged.requirements.requireFinanceReview)).toBe(true);
  });
});

describe('merge rule 7 — timeouts: shortest wins', () => {
  it('takes the tighter deadline when two rules disagree on one step', () => {
    const merged = mergeOutcomes(
      from(
        {
          type: 'REQUIRE_APPROVER',
          approver: manager,
          stepType: 'SINGLE',
          sequence: 1,
          timeoutHours: 72,
        },
        {
          type: 'REQUIRE_APPROVER',
          approver: financeRole,
          stepType: 'SINGLE',
          sequence: 1,
          timeoutHours: 24,
        },
      ),
    );

    expect(merged.requirements.approvalSteps[0]?.timeoutHours).toBe(24);
  });

  it('leaves the timeout unset when no rule specified one', () => {
    const merged = mergeOutcomes(
      from({ type: 'REQUIRE_APPROVER', approver: manager, stepType: 'SINGLE', sequence: 1 }),
    );

    // `null`, not `0`. "No deadline" and "a deadline of zero hours" are
    // different instructions, and the second would expire on arrival.
    expect(merged.requirements.approvalSteps[0]?.timeoutHours).toBeNull();
  });

  it('adopts a timeout from a later rule when the first set none', () => {
    const merged = mergeOutcomes(
      from(
        { type: 'REQUIRE_APPROVER', approver: manager, stepType: 'SINGLE', sequence: 1 },
        {
          type: 'REQUIRE_APPROVER',
          approver: financeRole,
          stepType: 'SINGLE',
          sequence: 1,
          timeoutHours: 12,
        },
      ),
    );

    expect(merged.requirements.approvalSteps[0]?.timeoutHours).toBe(12);
  });
});

describe('merge rule 8 — validity: shortest wins', () => {
  it('takes the most conservative expiry', () => {
    const merged = mergeOutcomes(
      from({ type: 'SET_VALIDITY', days: 30 }, { type: 'SET_VALIDITY', days: 7 }),
    );

    expect(merged.requirements.validityDays).toBe(7);
  });

  it('leaves validity unset when no rule set one', () => {
    const merged = mergeOutcomes(from({ type: 'ALLOW' }));

    expect(merged.requirements.validityDays).toBeNull();
  });
});

describe('merge rule 9 — exceptions accumulate', () => {
  it('retains every flagged code, each attributed to its rule', () => {
    const merged = mergeOutcomes(
      from(
        { type: 'FLAG_EXCEPTION', exceptionCode: 'OUT_OF_POLICY_VENDOR' },
        { type: 'FLAG_EXCEPTION', exceptionCode: 'WEEKEND_SPEND' },
      ),
    );

    expect(merged.exceptions).toEqual([
      { exceptionCode: 'OUT_OF_POLICY_VENDOR', ruleId: 'rule-1' },
      { exceptionCode: 'WEEKEND_SPEND', ruleId: 'rule-2' },
    ]);
  });

  /**
   * Exceptions survive a block. A refused request that also tripped two
   * exception flags should still show them: they are why a finance team looks
   * at it, and dropping them because the verdict was already negative would
   * lose the reason.
   */
  it('keeps exceptions on a blocked request', () => {
    const merged = mergeOutcomes(
      from(
        { type: 'FLAG_EXCEPTION', exceptionCode: 'DUPLICATE_SUSPECTED' },
        { type: 'BLOCK', reasonCode: 'OVER_LIMIT', message: 'Above your limit.' },
      ),
    );

    expect(merged.verdict).toBe('BLOCKED');
    expect(merged.exceptions).toHaveLength(1);
  });
});

describe('the empty merge', () => {
  it('allows when nothing fired at all', () => {
    const merged = mergeOutcomes([]);

    expect(merged.verdict).toBe('ALLOWED');
    expect(merged.requirements.approvalSteps).toEqual([]);
    expect(merged.requirements.requireReceipt).toBe(false);
    expect(merged.requirements.requireMemo).toEqual({ required: false, minLength: 0 });
  });
});

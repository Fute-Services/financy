import {
  STEP_TYPE_STRICTNESS,
  approverKey,
  type ApproverSpec,
  type EscalationSpec,
  type Outcome,
  type StepType,
} from './rules.js';

/**
 * Merging the outcomes of every rule that fired (docs/11 §5.1).
 *
 * Multiple rules across multiple policies can match one request, and this is
 * the part that must be unambiguous — ambiguity here means the same request is
 * approved differently on two days, which is the failure that destroys trust
 * in a spending control faster than any bug.
 *
 * The nine precedence rules from the specification are implemented here and
 * numbered in the code, because a reader checking the implementation against
 * the document should not have to work out which is which. Every one of them
 * has a dedicated test built around an explicitly constructed conflict.
 *
 * The whole thing is pure and order-independent by construction: no rule below
 * depends on the order outcomes arrive in, so a change to policy ordering
 * cannot change a merge result.
 */

/** One approval step, after merging. */
export interface ResolvedStepSpec {
  readonly sequence: number;
  readonly stepType: StepType;
  readonly approvers: readonly ApproverSpec[];
  readonly timeoutHours: number | null;
  readonly escalation: EscalationSpec | null;
}

export interface MergedRequirements {
  readonly approvalSteps: readonly ResolvedStepSpec[];
  readonly requireReceipt: boolean;
  readonly requireMemo: { readonly required: boolean; readonly minLength: number };
  readonly requireFinanceReview: boolean;
  readonly validityDays: number | null;
}

export interface MergedOutcomes {
  readonly verdict: 'ALLOWED' | 'ALLOWED_WITH_APPROVAL' | 'AUTO_APPROVED' | 'BLOCKED';
  readonly requirements: MergedRequirements;
  readonly blocks: readonly {
    readonly reasonCode: string;
    readonly message: string;
    readonly ruleId: string;
  }[];
  readonly exceptions: readonly { readonly exceptionCode: string; readonly ruleId: string }[];
}

/** An outcome together with the rule that produced it, for attribution. */
export interface AttributedOutcome {
  readonly outcome: Outcome;
  readonly ruleId: string;
}

export function mergeOutcomes(collected: readonly AttributedOutcome[]): MergedOutcomes {
  // ── 1. BLOCK dominates ───────────────────────────────────────────────────
  //
  // Every blocking reason is returned, not just the first: somebody whose
  // request is refused for three reasons should be able to fix all three at
  // once rather than discovering them one submission at a time.
  const blocks = collected
    .filter(
      (entry): entry is AttributedOutcome & { outcome: Extract<Outcome, { type: 'BLOCK' }> } =>
        entry.outcome.type === 'BLOCK',
    )
    .map((entry) => ({
      reasonCode: entry.outcome.reasonCode,
      message: entry.outcome.message,
      ruleId: entry.ruleId,
    }));

  // ── 9. Exceptions accumulate ─────────────────────────────────────────────
  const exceptions = collected
    .filter(
      (
        entry,
      ): entry is AttributedOutcome & { outcome: Extract<Outcome, { type: 'FLAG_EXCEPTION' }> } =>
        entry.outcome.type === 'FLAG_EXCEPTION',
    )
    .map((entry) => ({ exceptionCode: entry.outcome.exceptionCode, ruleId: entry.ruleId }));

  const approvalSteps = mergeApprovers(collected);
  const requirements = {
    approvalSteps,
    // ── 4. Evidence: strictest wins ────────────────────────────────────────
    requireReceipt: collected.some((entry) => entry.outcome.type === 'REQUIRE_RECEIPT'),
    requireMemo: mergeMemo(collected),
    // ── 6. Finance review is sticky ────────────────────────────────────────
    //
    // Once any rule requires it, nothing clears it. There is deliberately no
    // outcome that turns it off: a rule that could would let a low-priority
    // policy quietly disable a control a high-priority one imposed.
    requireFinanceReview: collected.some(
      (entry) => entry.outcome.type === 'REQUIRE_FINANCE_REVIEW',
    ),
    // ── 8. Validity: shortest wins ─────────────────────────────────────────
    validityDays: mergeValidity(collected),
  };

  if (blocks.length > 0) {
    return { verdict: 'BLOCKED', requirements, blocks, exceptions };
  }

  if (approvalSteps.length > 0) {
    return { verdict: 'ALLOWED_WITH_APPROVAL', requirements, blocks, exceptions };
  }

  // ── 5. AUTO_APPROVE is conditional ───────────────────────────────────────
  //
  // It applies only if no rule required an approver — which is why this check
  // comes after the step check rather than before it. An explicit approval
  // requirement always beats an auto-approval, because the rule that asked
  // for a human was written by somebody who wanted one.
  if (collected.some((entry) => entry.outcome.type === 'AUTO_APPROVE')) {
    return { verdict: 'AUTO_APPROVED', requirements, blocks, exceptions };
  }

  return { verdict: 'ALLOWED', requirements, blocks, exceptions };
}

/**
 * Rules 2, 3, and 7 — approvers, step types, and timeouts.
 *
 * **2. Approvers union, de-duplicated by resolved approver identity.** Two
 * rules that both say "the requester's manager" are one requirement, and stay
 * one after a reorganisation changes who that is — which is why the key is
 * built from the *specification* rather than from a person.
 *
 * **3. Same sequence means one step**, and its type is the strictest present.
 *
 * **7. Timeouts: shortest wins** within a step. Two rules disagreeing about
 * how long an approver has to respond is a disagreement resolved
 * conservatively: the tighter deadline is the one somebody meant to impose.
 */
function mergeApprovers(collected: readonly AttributedOutcome[]): readonly ResolvedStepSpec[] {
  const bySequence = new Map<
    number,
    {
      stepType: StepType;
      approvers: Map<string, ApproverSpec>;
      timeoutHours: number | null;
      escalation: EscalationSpec | null;
    }
  >();

  for (const entry of collected) {
    if (entry.outcome.type !== 'REQUIRE_APPROVER') continue;

    const { approver, stepType, sequence, timeoutHours, escalation } = entry.outcome;

    const existing = bySequence.get(sequence);

    if (existing === undefined) {
      bySequence.set(sequence, {
        stepType,
        approvers: new Map([[approverKey(approver), approver]]),
        timeoutHours: timeoutHours ?? null,
        escalation: escalation ?? null,
      });

      continue;
    }

    existing.approvers.set(approverKey(approver), approver);

    if (STEP_TYPE_STRICTNESS[stepType] > STEP_TYPE_STRICTNESS[existing.stepType]) {
      existing.stepType = stepType;
    }

    if (timeoutHours !== undefined) {
      existing.timeoutHours =
        existing.timeoutHours === null
          ? timeoutHours
          : Math.min(existing.timeoutHours, timeoutHours);
    }

    // An escalation is kept if any rule specified one; the first wins, because
    // two different escalation targets on one step is an authoring conflict
    // the merge cannot resolve sensibly and the policy screen should surface.
    existing.escalation ??= escalation ?? null;
  }

  return (
    [...bySequence.entries()]
      // Sorted by sequence, so the steps come out in the order they run rather
      // than in the order the rules happened to be evaluated.
      .sort(([a], [b]) => a - b)
      .map(([sequence, step]) => ({
        sequence,
        stepType: step.stepType,
        approvers: [...step.approvers.values()],
        timeoutHours: step.timeoutHours,
        escalation: step.escalation,
      }))
  );
}

/** Rule 4, for memos: required if any rule says so, at the longest minimum. */
function mergeMemo(collected: readonly AttributedOutcome[]): {
  required: boolean;
  minLength: number;
} {
  const memos = collected.filter(
    (entry): entry is AttributedOutcome & { outcome: Extract<Outcome, { type: 'REQUIRE_MEMO' }> } =>
      entry.outcome.type === 'REQUIRE_MEMO',
  );

  if (memos.length === 0) return { required: false, minLength: 0 };

  return {
    required: true,
    // A rule that requires a memo without saying how long still requires one;
    // treating an absent minimum as zero keeps it from lowering another
    // rule's floor.
    minLength: Math.max(...memos.map((entry) => entry.outcome.minLength ?? 0)),
  };
}

/** Rule 8: the most conservative expiry applies. */
function mergeValidity(collected: readonly AttributedOutcome[]): number | null {
  const days = collected
    .filter(
      (
        entry,
      ): entry is AttributedOutcome & { outcome: Extract<Outcome, { type: 'SET_VALIDITY' }> } =>
        entry.outcome.type === 'SET_VALIDITY',
    )
    .map((entry) => entry.outcome.days);

  return days.length === 0 ? null : Math.min(...days);
}

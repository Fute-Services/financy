import { evaluateCondition } from './conditions.js';
import { mergeOutcomes, type AttributedOutcome, type MergedRequirements } from './merge.js';
import { comparePolicyVersions, type Outcome, type PolicyVersion } from './rules.js';
import type { PolicyContext } from './context.js';

/**
 * The policy evaluator (docs/11 §5). **Pure — no I/O, no clock, no database.**
 *
 * That purity is not an aesthetic preference. It is what makes ten thousand
 * generated cases feasible, what lets a simulation endpoint answer "what would
 * this policy have done last March" without a time machine, and what makes a
 * decision reproducible from the record months later.
 *
 * The caller supplies the active policy versions. Deciding *which* versions
 * are active — organisation, spend type, effective dates, status — is a query,
 * and a query in here would be the one impure thing that made all of the above
 * impossible.
 */

/**
 * Bumped on any semantic change to evaluation or merge.
 *
 * Recorded on every decision, so a decision made under one set of merge
 * semantics stays interpretable after they change. Without it, a historical
 * "why was this approved?" screen would explain the past using today's rules
 * and quietly be wrong.
 */
export const POLICY_ENGINE_VERSION = '1.0.0';

export interface PolicyDecision {
  readonly verdict: 'ALLOWED' | 'ALLOWED_WITH_APPROVAL' | 'AUTO_APPROVED' | 'BLOCKED';
  readonly requirements: MergedRequirements;
  readonly blocks: readonly {
    readonly reasonCode: string;
    readonly message: string;
    readonly ruleId: string;
  }[];
  readonly exceptions: readonly { readonly exceptionCode: string; readonly ruleId: string }[];
  readonly evaluation: {
    readonly matchedRuleIds: readonly string[];
    readonly policyVersionIds: readonly string[];
    readonly evaluatedAt: string;
    readonly engineVersion: string;
    readonly durationMs: number;
  };
}

export interface EvaluateOptions {
  /**
   * Applied when no rule matched at all.
   *
   * An organisation with no policy still needs an answer, and the answer is a
   * configuration decision rather than a hardcoded one — some organisations
   * want everything allowed until a policy says otherwise, others want
   * nothing to move without a human. Defaults to allowing, because a fresh
   * organisation that blocks its own first purchase is a product nobody gets
   * past.
   */
  readonly defaultOutcomes?: readonly Outcome[];
  /**
   * How long the evaluation took, injected for the same reason `now` is.
   *
   * A duration read from a clock inside a pure function makes its output
   * differ between two identical calls, which breaks every golden-file test
   * in the suite.
   */
  readonly durationMs?: number;
}

export function evaluate(
  context: PolicyContext,
  policies: readonly PolicyVersion[],
  options: EvaluateOptions = {},
): PolicyDecision {
  const applicable = policies
    .filter((policy) => policy.spendTypes.includes(context.spendType))
    // Priority descending, then policy id — never insertion order. Without the
    // tiebreak, two policies of equal priority would evaluate in whatever
    // order the database returned them, and the same request could be decided
    // differently on two days with nothing changed.
    .sort(comparePolicyVersions);

  const collected: AttributedOutcome[] = [];
  const matchedRuleIds: string[] = [];
  const policyVersionIds: string[] = [];

  outer: for (const policy of applicable) {
    let policyContributed = false;

    // Rules run in sequence within a policy, ties broken by id — the same
    // determinism argument one level down.
    const rules = [...policy.rules].sort(
      (a, b) => a.sequence - b.sequence || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );

    for (const rule of rules) {
      if (!evaluateCondition(rule.condition, context)) continue;

      matchedRuleIds.push(rule.id);

      if (!policyContributed) {
        policyVersionIds.push(policy.id);
        policyContributed = true;
      }

      for (const outcome of rule.outcomes) {
        collected.push({ outcome, ruleId: rule.id });
      }

      // A terminal rule, or any BLOCK, stops **everything** — not just the
      // rest of this policy. A block is final by definition, and a terminal
      // rule is the blunt "this is an override, nothing else applies" that
      // an emergency needs to be expressible without editing every policy.
      if (rule.terminal || rule.outcomes.some((outcome) => outcome.type === 'BLOCK')) {
        break outer;
      }
    }
  }

  // Nothing matched: the organisation's default applies. Recorded as matching
  // no rules, which is the truth — a reader of the decision should be able to
  // see that it came from the default rather than from a policy.
  const effective =
    collected.length > 0
      ? collected
      : (options.defaultOutcomes ?? [{ type: 'ALLOW' } as const]).map((outcome) => ({
          outcome,
          ruleId: 'default',
        }));

  const merged = mergeOutcomes(effective);

  return {
    verdict: merged.verdict,
    requirements: merged.requirements,
    blocks: merged.blocks,
    exceptions: merged.exceptions,
    evaluation: {
      matchedRuleIds,
      policyVersionIds,
      // From the context's injected clock, not from `Date.now()`. Two
      // identical calls must produce two identical decisions.
      evaluatedAt: context.temporal.now.toISOString(),
      engineVersion: POLICY_ENGINE_VERSION,
      durationMs: options.durationMs ?? 0,
    },
  };
}

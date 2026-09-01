import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { POLICY_ENGINE_VERSION, evaluate, type PolicyDecision } from '../evaluator.js';
import {
  POLICY_FIELDS,
  operatorsForField,
  valueKindsFor,
  type ComparisonCondition,
  type Condition,
} from '../rules.js';
import { hydrateContext, type ExpectedDecision, type GoldenFixture } from './fixtures.js';

/**
 * The golden-file suite (task 2.1.9, docs/11 §9).
 *
 * A directory of `(context, policies) → expected decision` fixtures. Any
 * change to the evaluator that alters one of them fails the build and has to
 * be re-approved deliberately, with a note — which is what stops a "harmless
 * refactor" from silently changing who has to approve a £50,000 purchase.
 *
 * ## Why these are data and not tests
 *
 * A case written as code can be corrected in the same commit that broke it, by
 * the same person, and the diff reads as one coherent change. A case that is
 * data has to be edited separately: the diff shows the old decision and the new
 * one side by side, and a reviewer sees "this request used to need two
 * approvals and now needs one" instead of a green checkmark.
 *
 * ## Re-approving a change
 *
 * `UPDATE_GOLDEN=1 pnpm --filter @financy/core test` rewrites the expectations.
 * It exists because writing them by hand for nine fixtures is a transcription
 * exercise, not a judgement — but the judgement is still required: the diff has
 * to be read, and the fixture's `why` is the sentence to read it against. A
 * fixture whose `why` no longer describes what it asserts is a fixture that
 * should have been deleted rather than updated.
 */
const CASES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'cases');

const UPDATE = process.env['UPDATE_GOLDEN'] === '1';

const files = readdirSync(CASES_DIR)
  .filter((file) => file.endsWith('.json'))
  .sort();

describe('the policy engine, against its golden files', () => {
  it('has fixtures at all', () => {
    // A directory that emptied itself — a bad merge, a moved folder — would
    // otherwise make this whole suite pass by having nothing to check.
    expect(files.length).toBeGreaterThanOrEqual(9);
  });

  /**
   * Every rule in every fixture is one the engine could actually fire.
   *
   * **This exists because writing these fixtures produced exactly the failure
   * the design warns about.** A fixture is JSON, so the closed field set and
   * the operator tables — which make a bad rule a compile error in TypeScript
   * — say nothing about it. Two fixtures were written with `categoryPath`
   * instead of `category.path` and `EQ` instead of `IS_TRUE`, and both
   * evaluated to a perfectly calm `ALLOWED`: no error, no warning, just a rule
   * that never fired and a golden file that would have recorded the wrong
   * decision as correct forever.
   *
   * A rule that cannot fire is worse than a rule that is wrong (docs/11 §4).
   * The type system cannot see these; this can.
   */
  it('uses only fields and operators the engine knows', () => {
    for (const file of files) {
      const fixture = JSON.parse(readFileSync(path.join(CASES_DIR, file), 'utf8')) as GoldenFixture;

      for (const policy of fixture.policies) {
        for (const rule of policy.rules) {
          for (const comparison of comparisons(rule.condition)) {
            expect(POLICY_FIELDS, `${file} → ${rule.id}`).toContain(comparison.field);

            expect(
              operatorsForField(comparison.field),
              `${file} → ${rule.id}: "${comparison.operator}" is not an operator for ${comparison.field}`,
            ).toContain(comparison.operator);

            expect(
              valueKindsFor(comparison.field, comparison.operator),
              `${file} → ${rule.id}: ${comparison.operator} on ${comparison.field} does not take a ${comparison.value.kind} value`,
            ).toContain(comparison.value.kind);
          }
        }
      }
    }
  });

  for (const file of files) {
    const fixture = JSON.parse(readFileSync(path.join(CASES_DIR, file), 'utf8')) as GoldenFixture;

    it(`${fixture.name}: ${fixture.why}`, () => {
      const decision = evaluate(hydrateContext(fixture.context), fixture.policies, {
        ...(fixture.defaultOutcomes === undefined
          ? {}
          : { defaultOutcomes: fixture.defaultOutcomes }),
        // Fixed, so a fixture never differs by a millisecond of measurement.
        durationMs: 0,
      });

      const actual = project(decision);

      if (UPDATE) {
        writeFileSync(
          path.join(CASES_DIR, file),
          `${JSON.stringify({ ...fixture, expected: actual }, null, 2)}\n`,
          'utf8',
        );

        return;
      }

      expect(actual, explain(file)).toEqual(fixture.expected);
    });
  }
});

/**
 * The decision, reduced to what a fixture asserts.
 *
 * `evaluatedAt` and `durationMs` are excluded on purpose: one is a clock
 * reading and the other a measurement, and asserting on either would make every
 * fixture fail for a reason that has nothing to do with policy. The engine
 * version is included, because a bump to it *should* force every fixture to be
 * looked at again.
 */
function project(decision: PolicyDecision): ExpectedDecision {
  return {
    verdict: decision.verdict,
    engineVersion: decision.evaluation.engineVersion,
    matchedRuleIds: [...decision.evaluation.matchedRuleIds],
    policyVersionIds: [...decision.evaluation.policyVersionIds],
    blocks: decision.blocks.map((block) => ({
      reasonCode: block.reasonCode,
      ruleId: block.ruleId,
    })),
    exceptions: decision.exceptions.map((exception) => ({
      exceptionCode: exception.exceptionCode,
      ruleId: exception.ruleId,
    })),
    requirements: {
      approvalSteps: decision.requirements.approvalSteps.map((step) => ({
        sequence: step.sequence,
        stepType: step.stepType,
        // The kinds rather than the whole specs: a fixture asserting on the
        // full `ApproverSpec` would fail whenever an unrelated optional field
        // was added to it, which is a change to the shape rather than to the
        // decision.
        approverKinds: step.approvers.map((approver) => approver.kind).sort(),
        timeoutHours: step.timeoutHours,
      })),
      requireReceipt: decision.requirements.requireReceipt,
      requireMemo: decision.requirements.requireMemo,
      requireFinanceReview: decision.requirements.requireFinanceReview,
      validityDays: decision.requirements.validityDays,
    },
  };
}

/** Every comparison in a condition tree, groups flattened. */
function comparisons(condition: Condition): ComparisonCondition[] {
  return condition.type === 'COMPARISON'
    ? [condition]
    : condition.conditions.flatMap((nested) => comparisons(nested));
}

function explain(file: string): string {
  return `Golden fixture ${file} no longer produces the decision it records.

If that change is intended, read the fixture's "why" first and make sure it
still describes what the fixture asserts. Then re-approve it deliberately:

  UPDATE_GOLDEN=1 pnpm --filter @financy/core test golden

and include the fixture diff in the same commit as the evaluator change, so a
reviewer sees which decision moved. The engine version is ${POLICY_ENGINE_VERSION}; a change to
the merge semantics should bump it (docs/11 §5).`;
}

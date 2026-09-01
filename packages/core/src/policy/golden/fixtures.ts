import { Money } from '../../money.js';
import type { PolicyContext } from '../context.js';
import type { Outcome, PolicyVersion } from '../rules.js';

/**
 * The wire form of a golden fixture (docs/11 §9).
 *
 * **JSON rather than TypeScript**, and that is the whole point. A fixture
 * written as code can be "fixed" in the same commit that changes the
 * evaluator, by the same person, and the diff reads as one change. A fixture
 * that is data has to be edited separately and deliberately, and the diff says
 * exactly which decision changed and how — which is what stops a harmless
 * refactor from silently changing who has to approve a £50,000 purchase.
 *
 * `why` is not a comment. It is the sentence somebody re-approving a changed
 * fixture has to read first, and it is the difference between "the golden file
 * changed, update it" and "wait, that rule is meant to fire".
 */
export interface GoldenFixture {
  readonly name: string;
  readonly why: string;
  readonly context: SerialisedContext;
  readonly policies: readonly PolicyVersion[];
  readonly defaultOutcomes?: readonly Outcome[];
  readonly expected: ExpectedDecision;
}

/**
 * What the fixture asserts about the decision.
 *
 * Deliberately **not** the whole `PolicyDecision`. The duration is a
 * measurement and the evaluated-at is a clock reading; asserting on them would
 * make every fixture fail for reasons that have nothing to do with policy. The
 * engine version *is* asserted, because a change to it is exactly the kind of
 * change that should force every fixture to be looked at again.
 */
export interface ExpectedDecision {
  readonly verdict: 'ALLOWED' | 'ALLOWED_WITH_APPROVAL' | 'AUTO_APPROVED' | 'BLOCKED';
  readonly engineVersion: string;
  readonly matchedRuleIds: readonly string[];
  readonly policyVersionIds: readonly string[];
  readonly blocks: readonly { readonly reasonCode: string; readonly ruleId: string }[];
  readonly exceptions: readonly { readonly exceptionCode: string; readonly ruleId: string }[];
  readonly requirements: {
    readonly approvalSteps: readonly {
      readonly sequence: number;
      readonly stepType: string;
      readonly approverKinds: readonly string[];
      readonly timeoutHours: number | null;
    }[];
    readonly requireReceipt: boolean;
    readonly requireMemo: { readonly required: boolean; readonly minLength: number };
    readonly requireFinanceReview: boolean;
    readonly validityDays: number | null;
  };
}

export interface SerialisedMoney {
  readonly amount: string;
  readonly currency: string;
}

/**
 * The context as JSON.
 *
 * Money is `{ amount, currency }` and never a number — a fixture holding
 * `1000.1` would already have lost the thing this system exists to keep — and
 * timestamps are ISO strings, so a fixture is readable and diffable by
 * somebody who has never opened the evaluator.
 */
export interface SerialisedContext {
  readonly organizationId: string;
  readonly spendType: PolicyContext['spendType'];
  readonly amount: SerialisedMoney;
  readonly amountInBaseCurrency: SerialisedMoney;
  readonly requester: PolicyContext['requester'];
  readonly classification: PolicyContext['classification'];
  readonly budget: {
    readonly budgetLineId: string | null;
    readonly allocated: SerialisedMoney;
    readonly committed: SerialisedMoney;
    readonly actual: SerialisedMoney;
    readonly remaining: SerialisedMoney;
    readonly utilizationAfterThisSpend: number;
    readonly wouldExceed: boolean;
  } | null;
  readonly evidence: PolicyContext['evidence'];
  readonly temporal: {
    readonly now: string;
    readonly neededBy: string | null;
    readonly fiscalPeriod: string;
  };
  readonly history: {
    readonly requesterSpendThisMonth: SerialisedMoney;
    readonly requesterSpendThisMonthInCategory: SerialisedMoney;
    readonly similarRequestsLast30Days: number;
  };
}

export function hydrateContext(serialised: SerialisedContext): PolicyContext {
  return {
    organizationId: serialised.organizationId,
    spendType: serialised.spendType,
    amount: money(serialised.amount),
    amountInBaseCurrency: money(serialised.amountInBaseCurrency),
    requester: serialised.requester,
    classification: serialised.classification,
    budget:
      serialised.budget === null
        ? null
        : {
            budgetLineId: serialised.budget.budgetLineId,
            allocated: money(serialised.budget.allocated),
            committed: money(serialised.budget.committed),
            actual: money(serialised.budget.actual),
            remaining: money(serialised.budget.remaining),
            utilizationAfterThisSpend: serialised.budget.utilizationAfterThisSpend,
            wouldExceed: serialised.budget.wouldExceed,
          },
    evidence: serialised.evidence,
    temporal: {
      now: new Date(serialised.temporal.now),
      neededBy:
        serialised.temporal.neededBy === null ? null : new Date(serialised.temporal.neededBy),
      fiscalPeriod: serialised.temporal.fiscalPeriod,
    },
    history: {
      requesterSpendThisMonth: money(serialised.history.requesterSpendThisMonth),
      requesterSpendThisMonthInCategory: money(
        serialised.history.requesterSpendThisMonthInCategory,
      ),
      similarRequestsLast30Days: serialised.history.similarRequestsLast30Days,
    },
  };
}

function money(value: SerialisedMoney): Money {
  return Money.of(value.amount, value.currency);
}

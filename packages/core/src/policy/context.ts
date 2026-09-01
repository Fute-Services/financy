import type { Money } from '../money.js';

/**
 * The complete, explicit input to a policy evaluation (docs/11 §3).
 *
 * **Nothing is read from ambient state.** If the evaluator needs it, it is
 * here — which is what makes the evaluator a pure function, and what makes
 * ten thousand generated cases feasible instead of ten hand-written ones.
 *
 * `now` in particular is injected rather than read. A rule about the last day
 * of a quarter has to be testable without moving the system clock, and a
 * decision that would evaluate differently tomorrow is a decision nobody can
 * reproduce from the record.
 */
export interface PolicyContext {
  readonly organizationId: string;
  readonly spendType: 'CARD' | 'REIMBURSEMENT' | 'BILL' | 'PURCHASE_ORDER' | 'SPEND_REQUEST';

  /** Never a number. A float amount is a rounding error waiting for a total. */
  readonly amount: Money;
  /** Converted at a stored, recorded rate — never at evaluation time. */
  readonly amountInBaseCurrency: Money;

  readonly requester: {
    readonly membershipId: string;
    readonly roleKey: string;
    readonly departmentId: string | null;
    /** Materialised path, so a rule can match a subtree in one comparison. */
    readonly departmentPath: string;
    readonly entityId: string;
    /** Nearest manager first. */
    readonly managerChain: readonly string[];
    readonly tenureDays: number;
  };

  readonly classification: {
    readonly categoryId: string | null;
    readonly categoryPath: string;
    readonly projectId: string | null;
    readonly vendorId: string | null;
    readonly merchantName: string | null;
  };

  /** `null` when the spend falls outside any budget line at all. */
  readonly budget: {
    readonly budgetLineId: string | null;
    readonly allocated: Money;
    readonly committed: Money;
    readonly actual: Money;
    readonly remaining: Money;
    /** 0..n, where 1.0 is fully consumed. */
    readonly utilizationAfterThisSpend: number;
    readonly wouldExceed: boolean;
  } | null;

  readonly evidence: {
    readonly hasReceipt: boolean;
    readonly hasMemo: boolean;
    readonly memoLength: number;
    readonly receiptCount: number;
  };

  readonly temporal: {
    /** Injected. Never `Date.now()` inside the evaluator. */
    readonly now: Date;
    readonly neededBy: Date | null;
    readonly fiscalPeriod: string;
  };

  readonly history: {
    readonly requesterSpendThisMonth: Money;
    readonly requesterSpendThisMonthInCategory: Money;
    readonly similarRequestsLast30Days: number;
  };
}

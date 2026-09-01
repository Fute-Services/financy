import { describe, expect, it } from 'vitest';

import { Money } from '../money.js';
import type { PolicyContext } from './context.js';
import { evaluate } from './evaluator.js';
import type { Condition, Outcome, PolicyRule, PolicyVersion } from './rules.js';

/**
 * Determinism and cost (docs/11 §9, the last two rows).
 *
 * ## Why generated rather than hand-written
 *
 * The failure this guards against is not "the evaluator is wrong" — the
 * condition, merge, and golden suites cover that. It is **the same request
 * decided differently on two days with nothing changed**, because the
 * database happened to return two equal-priority policies in the other order.
 * That is invisible to any hand-written case: whichever order you write down
 * is the order you assert, and the bug lives in the order you did not write.
 *
 * So: generate contexts, shuffle the policies, and require one answer. A
 * failure here names the seed, which reproduces the exact pair.
 *
 * ## The randomness is seeded, and that is not a detail
 *
 * A test that failed one run in fifty on a random seed nobody recorded is a
 * test that gets marked flaky and skipped. This one is reproducible: the same
 * seed always produces the same cases, so a failure can be re-run.
 */

/** A tiny deterministic PRNG (mulberry32). Reproducible by seed, by design. */
function random(seed: number): () => number {
  let state = seed >>> 0;

  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

const CATEGORIES = [
  '/cat-operations/cat-software/',
  '/cat-travel/',
  '/cat-gifts/',
  '/cat-operations/cat-hardware/',
];

const DEPARTMENTS = ['/dept-eng/', '/dept-eng/dept-platform/', '/dept-sales/', '/dept-exec/'];

function generateContext(next: () => number): PolicyContext {
  const amount = (next() * 20_000).toFixed(2);
  const departmentPath = DEPARTMENTS[Math.floor(next() * DEPARTMENTS.length)] ?? '/dept-eng/';
  const categoryPath = CATEGORIES[Math.floor(next() * CATEGORIES.length)] ?? '/cat-travel/';
  const wouldExceed = next() > 0.7;

  return {
    organizationId: 'org-generated',
    spendType: 'SPEND_REQUEST',
    amount: Money.of(amount, 'USD'),
    amountInBaseCurrency: Money.of(amount, 'USD'),
    requester: {
      membershipId: 'mem-generated',
      roleKey: next() > 0.5 ? 'EMPLOYEE' : 'MANAGER',
      departmentId: 'dept-generated',
      departmentPath,
      entityId: 'ent-us',
      managerChain: ['mem-manager'],
      tenureDays: Math.floor(next() * 2000),
    },
    classification: {
      categoryId: 'cat-generated',
      categoryPath,
      projectId: null,
      vendorId: null,
      merchantName: null,
    },
    budget:
      next() > 0.5
        ? {
            budgetLineId: 'line-generated',
            allocated: Money.of('10000.00', 'USD'),
            committed: Money.of('4000.00', 'USD'),
            actual: Money.of('1000.00', 'USD'),
            remaining: Money.of('5000.00', 'USD'),
            utilizationAfterThisSpend: next(),
            wouldExceed,
          }
        : null,
    evidence: {
      hasReceipt: next() > 0.5,
      hasMemo: next() > 0.5,
      memoLength: Math.floor(next() * 300),
      receiptCount: 0,
    },
    temporal: {
      now: new Date('2026-09-02T10:00:00.000Z'),
      neededBy: null,
      fiscalPeriod: '2026-Q3',
    },
    history: {
      requesterSpendThisMonth: Money.of('0.00', 'USD'),
      requesterSpendThisMonthInCategory: Money.of('0.00', 'USD'),
      similarRequestsLast30Days: Math.floor(next() * 5),
    },
  };
}

const over = (limit: string): Condition => ({
  type: 'COMPARISON',
  field: 'amountInBaseCurrency',
  operator: 'GT',
  value: { kind: 'money', amount: limit, currency: 'USD' },
});

const inTree = (
  field: 'category.path' | 'requester.departmentPath',
  prefix: string,
): Condition => ({
  type: 'COMPARISON',
  field,
  operator: 'IS_DESCENDANT_OF',
  value: { kind: 'string', value: prefix },
});

const approver = (sequence: number, timeoutHours: number): Outcome => ({
  type: 'REQUIRE_APPROVER',
  approver: { kind: 'ROLE', roleKey: 'FINANCE_ADMIN', scope: 'ORGANIZATION' },
  stepType: 'SINGLE',
  sequence,
  timeoutHours,
});

/**
 * Policies that deliberately collide.
 *
 * Two share a priority, two write to the same step sequence with different
 * timeouts, and one is terminal. A set where nothing overlapped would pass
 * this test no matter how the evaluator ordered things.
 */
const POLICIES: PolicyVersion[] = [
  {
    id: 'pol-a-v1',
    policyId: 'pol-a',
    version: 1,
    spendTypes: ['SPEND_REQUEST'],
    priority: 100,
    rules: [
      {
        id: 'rule-a1',
        name: 'over 1000',
        sequence: 1,
        condition: over('1000.00'),
        outcomes: [approver(1, 48)],
        terminal: false,
      },
    ],
  },
  {
    id: 'pol-b-v1',
    policyId: 'pol-b',
    version: 1,
    spendTypes: ['SPEND_REQUEST'],
    // Equal priority to pol-a on purpose: this is the pair whose order the
    // database does not fix and the evaluator must.
    priority: 100,
    rules: [
      {
        id: 'rule-b1',
        name: 'over 500, tighter deadline',
        sequence: 1,
        condition: over('500.00'),
        outcomes: [approver(1, 24), { type: 'REQUIRE_MEMO', minLength: 40 }],
        terminal: false,
      },
    ],
  },
  {
    id: 'pol-c-v1',
    policyId: 'pol-c',
    version: 1,
    spendTypes: ['SPEND_REQUEST'],
    priority: 300,
    rules: [
      {
        id: 'rule-c1',
        name: 'gifts are prohibited',
        sequence: 1,
        condition: inTree('category.path', '/cat-gifts/'),
        outcomes: [
          { type: 'BLOCK', reasonCode: 'CATEGORY_PROHIBITED', message: 'Not company spend.' },
        ],
        terminal: false,
      },
      {
        id: 'rule-c2',
        name: 'budget exceeded',
        sequence: 2,
        condition: {
          type: 'COMPARISON',
          field: 'budget.wouldExceed',
          operator: 'IS_TRUE',
          value: { kind: 'none' },
        },
        outcomes: [{ type: 'REQUIRE_FINANCE_REVIEW' }, { type: 'SET_VALIDITY', days: 7 }],
        terminal: false,
      },
    ],
  },
  {
    id: 'pol-d-v1',
    policyId: 'pol-d',
    version: 1,
    spendTypes: ['SPEND_REQUEST'],
    priority: 500,
    rules: [
      {
        id: 'rule-d1',
        name: 'executives are pre-authorised',
        sequence: 1,
        condition: inTree('requester.departmentPath', '/dept-exec/'),
        outcomes: [{ type: 'FLAG_EXCEPTION', exceptionCode: 'EXECUTIVE_PREAUTHORISED' }],
        terminal: true,
      },
    ],
  },
];

function shuffle<T>(items: readonly T[], next: () => number): T[] {
  const copy = [...items];

  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(next() * (i + 1));
    const a = copy[i];
    const b = copy[j];

    if (a !== undefined && b !== undefined) {
      copy[i] = b;
      copy[j] = a;
    }
  }

  return copy;
}

/** Everything a decision says, minus the two fields that are measurements. */
function comparable(decision: ReturnType<typeof evaluate>): string {
  return JSON.stringify({
    verdict: decision.verdict,
    requirements: decision.requirements,
    blocks: decision.blocks,
    exceptions: decision.exceptions,
    matchedRuleIds: decision.evaluation.matchedRuleIds,
    policyVersionIds: decision.evaluation.policyVersionIds,
  });
}

describe('determinism', () => {
  it('decides identically however the policies arrived, over ten thousand contexts', () => {
    const next = random(20260902);

    for (let iteration = 0; iteration < 10_000; iteration += 1) {
      const context = generateContext(next);

      const first = comparable(evaluate(context, shuffle(POLICIES, next), { durationMs: 0 }));
      const second = comparable(evaluate(context, shuffle(POLICIES, next), { durationMs: 0 }));

      if (first !== second) {
        // Named, so the failure is reproducible rather than "it happened once".
        expect(first, `iteration ${String(iteration)} decided differently by input order`).toBe(
          second,
        );
      }
    }
  });

  it('gives the same answer to the same request twice, including the rule attribution', () => {
    const context = generateContext(random(7));

    expect(comparable(evaluate(context, POLICIES, { durationMs: 0 }))).toBe(
      comparable(evaluate(context, POLICIES, { durationMs: 0 })),
    );
  });
});

describe('cost', () => {
  /**
   * 100 policies, 1,000 rules, under 50 ms at p95 (docs/11 §9).
   *
   * The budget is not about a request feeling fast — it is evaluated inside
   * the submission transaction, and a slow evaluator holds a database
   * transaction open across every policy an organisation has ever written.
   *
   * Measured as a p95 over 200 runs rather than as a single timing, because
   * one run measures whatever else the machine was doing.
   */
  it('evaluates 100 policies and 1,000 rules well inside its budget', () => {
    const policies: PolicyVersion[] = [];

    for (let p = 0; p < 100; p += 1) {
      const rules: PolicyRule[] = [];

      for (let r = 0; r < 10; r += 1) {
        rules.push({
          id: `rule-${String(p)}-${String(r)}`,
          name: `generated ${String(p)}/${String(r)}`,
          sequence: r,
          condition: {
            type: 'GROUP',
            operator: 'ALL',
            conditions: [
              over(`${String((r + 1) * 100)}.00`),
              inTree('category.path', '/cat-operations/'),
            ],
          },
          outcomes: [approver(1, 24 + r)],
          terminal: false,
        });
      }

      policies.push({
        id: `pol-${String(p)}-v1`,
        policyId: `pol-${String(p)}`,
        version: 1,
        spendTypes: ['SPEND_REQUEST'],
        priority: p,
        rules,
      });
    }

    const context = generateContext(random(99));
    const timings: number[] = [];

    for (let run = 0; run < 200; run += 1) {
      const started = performance.now();
      evaluate(context, policies);
      timings.push(performance.now() - started);
    }

    timings.sort((a, b) => a - b);
    const p95 = timings[Math.floor(timings.length * 0.95)] ?? 0;

    expect(p95, `p95 was ${p95.toFixed(2)}ms across 200 runs`).toBeLessThan(50);
  });
});

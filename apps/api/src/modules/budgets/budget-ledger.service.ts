import { randomInt } from 'node:crypto';

import type { BudgetPosition, BudgetSourceType } from '@financy/contracts';
import { Money, newId } from '@financy/core';
import { Injectable } from '@nestjs/common';

import { AuditService } from '../../platform/audit/index.js';
import { isWriteConflict } from '../../platform/concurrency/index.js';
import { DatabaseService } from '../../platform/database/index.js';
import { getContext } from '../../platform/request-context/index.js';

/**
 * What a spend looks like to a budget.
 *
 * Deliberately not "an expense" or "a transaction". Five modules will
 * eventually move money against a budget and each of them has a different
 * record; what they share is a date, an amount, and the four dimensions a
 * budget can be drawn around.
 */
export interface SpendCoordinates {
  readonly entityId: string;
  readonly departmentId?: string | null;
  readonly projectId?: string | null;
  readonly categoryId?: string | null;
  /** When the money was spent or committed, which decides the period. */
  readonly occurredAt: Date;
  readonly amount: Money;
}

/** `APPLIED` appended a movement; `ALREADY_APPLIED` means this one already exists. */
export type MovementOutcome = 'APPLIED' | 'ALREADY_APPLIED';

/** A crossing worth telling somebody about, returned rather than sent. */
export interface ThresholdCrossing {
  readonly budgetId: string;
  readonly budgetLineId: string;
  readonly threshold: number;
  readonly utilization: number;
}

const PRISMA_UNIQUE_VIOLATION = 'P2002';

/**
 * How many times a contended line is worth re-deriving.
 *
 * Fifty approvals landing on one budget in the same instant is not a stress
 * test — it is the last day of a quarter. Each attempt is one short read and
 * one guarded write, so the ceiling is generous on purpose: giving up early
 * turns a busy budget into an error the approver cannot act on, and the work
 * that was refused is work somebody redoes by hand.
 */
const MAX_ATTEMPTS = 40;

/**
 * The budget ledger (FR-BDG-002…004, 006, 008; epic 4.1).
 *
 * ## The balances are derived, not accumulated
 *
 * `budget_movements` is append-only and is what actually happened.
 * `committed_amount` and `actual_amount` on the line are **re-summed from that
 * ledger** after every append and written whole. FR-BDG-003 asks that the two
 * always agree; deriving rather than incrementing makes that true by
 * construction instead of true as long as nothing goes wrong. A dropped
 * increment is invisible and permanent; a dropped derivation is repaired by the
 * next movement on the line.
 *
 * ## The unique index is the idempotency, not a check
 *
 * `(line, sourceType, sourceId, movementType)` is unique. A retried job, a
 * double-clicked approval, and a queue redelivery all land on that index and
 * the second one is told `ALREADY_APPLIED`. A read-then-write guard would let
 * two concurrent writers both pass the read; this one cannot be passed twice.
 *
 * ## Why there is no transaction around the pair
 *
 * PostgreSQL would `SELECT ... FOR UPDATE` the line and do both inside one
 * transaction (docs/09 §7.3). On MongoDB that is the wrong shape, and the
 * difference is not academic: fifty concurrent transactions touching one
 * document abort one another, and the retries livelock rather than converge —
 * measured on the fifty-way test below, not assumed.
 *
 * So the append is a write to its **own** document, which never contends, and
 * the materialisation is a single guarded update that re-reads the ledger.
 * Losing the guard costs one cheap re-read, and the writer that wins writes the
 * total of every movement committed so far — including the ones whose own
 * updates were superseded. The line converges on the truth from whichever
 * direction the writers arrive.
 *
 * The window between the append and the materialisation is the honest cost: a
 * process that dies inside it leaves a line reading low until the next movement
 * on it. The ledger is still right, which is the property an audit rests on,
 * and the invariant is restored automatically rather than by a repair script
 * somebody has to remember exists.
 *
 * ## Nothing is ever deleted
 *
 * A cancelled commitment is a `RELEASE` (FR-BDG-008). Deleting the commitment
 * would leave a budget whose history cannot explain its own balance, and the
 * first question anybody asks about a budget is where the money went.
 */
@Injectable()
export class BudgetLedgerService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  /** Reserve budget for something approved but not yet paid (FR-SPD-007). */
  async commit(
    organizationId: string,
    coordinates: SpendCoordinates,
    source: { type: BudgetSourceType; id: string },
    memo?: string,
  ): Promise<ThresholdCrossing[]> {
    return this.applyAcrossMatches(organizationId, coordinates, {
      movementType: 'COMMITMENT',
      direction: 'INCREASE',
      source,
      ...(memo === undefined ? {} : { memo }),
    });
  }

  /**
   * Record money that actually left, releasing any commitment the same source
   * had made (FR-TXN-008).
   *
   * A posted charge that recorded its actual and failed to release its
   * commitment double-counts, and the budget reads as twice as spent until
   * somebody notices — so the release is part of this call rather than the
   * caller's to remember.
   */
  async actualize(
    organizationId: string,
    coordinates: SpendCoordinates,
    source: { type: BudgetSourceType; id: string },
    memo?: string,
  ): Promise<ThresholdCrossing[]> {
    return this.applyAcrossMatches(organizationId, coordinates, {
      movementType: 'ACTUAL',
      direction: 'INCREASE',
      source,
      releaseCommitment: true,
      ...(memo === undefined ? {} : { memo }),
    });
  }

  /** Give a commitment back — a cancellation, an expiry, a reversal. */
  async release(
    organizationId: string,
    coordinates: SpendCoordinates,
    source: { type: BudgetSourceType; id: string },
    memo?: string,
  ): Promise<ThresholdCrossing[]> {
    return this.applyAcrossMatches(organizationId, coordinates, {
      movementType: 'RELEASE',
      direction: 'DECREASE',
      source,
      ...(memo === undefined ? {} : { memo }),
    });
  }

  /**
   * Where a spend would land, and whether it fits.
   *
   * Read-only, and the answer both policy evaluation and the overspend check
   * use. It returns every matching line rather than one, because a charge can
   * legitimately draw on a departmental budget and an organisation-wide one at
   * once, and blocking on the tighter of the two is only possible if both are
   * visible.
   */
  async positions(
    organizationId: string,
    coordinates: SpendCoordinates,
  ): Promise<BudgetPosition[]> {
    const matches = await this.matchingLines(organizationId, coordinates);

    return matches.map(({ budget, line }) => {
      const allocated = Money.of(line.allocatedAmount, line.currency);
      const committed = Money.of(line.committedAmount, line.currency);
      const actual = Money.of(line.actualAmount, line.currency);
      const remaining = allocated.subtract(committed).subtract(actual);

      return {
        budgetId: budget.id,
        budgetLineId: line.id,
        name: budget.name,
        currency: line.currency,
        allocated: allocated.toJSON().amount,
        committed: committed.toJSON().amount,
        actual: actual.toJSON().amount,
        remaining: remaining.toJSON().amount,
        utilization: utilizationOf(allocated, committed.add(actual)),
        overspendBehavior: budget.overspendBehavior,
        wouldExceed: coordinates.amount.greaterThan(remaining),
      };
    });
  }

  /**
   * Re-sum one line's ledger and write the result.
   *
   * Public because a repair is exactly this operation with no movement in front
   * of it, and because the invariant is worth being able to restore on demand.
   *
   * The `where: { version }` is what makes concurrent callers safe: a writer
   * whose read went stale updates nothing, learns it, and reads again. It never
   * writes a stale total over a fresh one.
   */
  async materialize(organizationId: string, budgetLineId: string): Promise<void> {
    await withRetry(async () => {
      const line = await this.database.unscoped.budgetLine.findFirst({
        where: { id: budgetLineId, organizationId },
      });

      if (line === null) return;

      const movements = await this.database.unscoped.budgetMovement.findMany({
        where: { budgetLineId },
        select: { movementType: true, direction: true, amount: true },
      });

      const zero = Money.zero(line.currency);

      const total = (types: readonly string[]): Money =>
        movements
          .filter((movement) => types.includes(movement.movementType))
          .reduce((sum, movement) => {
            const amount = Money.of(movement.amount, line.currency);
            return movement.direction === 'INCREASE' ? sum.add(amount) : sum.subtract(amount);
          }, zero);

      // `ADJUSTMENT` deliberately moves nothing here. It records a change to
      // the *allocation*, which `allocate` writes directly; folding it in would
      // make one movement both the history of a decision and half of the
      // balance that decision changed.
      const committed = total(['COMMITMENT', 'RELEASE']).toJSON().amount;
      const actual = total(['ACTUAL']).toJSON().amount;

      if (committed === line.committedAmount && actual === line.actualAmount) return;

      const updated = await this.database.unscoped.budgetLine.updateMany({
        where: { id: budgetLineId, version: line.version },
        data: { committedAmount: committed, actualAmount: actual, version: { increment: 1 } },
      });

      if (updated.count === 0) throw new StaleLineError();
    });
  }

  /**
   * Append one movement, if it is not already there.
   *
   * The pre-check is the fast path for a replay and is **not** the guarantee —
   * two writers can both read nothing. The unique index is what decides, and a
   * writer that loses to it is told the same thing.
   */
  private async append(request: {
    organizationId: string;
    budgetLineId: string;
    movementType: 'COMMITMENT' | 'ACTUAL' | 'RELEASE' | 'ADJUSTMENT';
    direction: 'INCREASE' | 'DECREASE';
    amount: Money;
    sourceType: BudgetSourceType;
    sourceId: string;
    memo?: string | null;
  }): Promise<MovementOutcome> {
    const already = await this.database.unscoped.budgetMovement.findFirst({
      where: {
        budgetLineId: request.budgetLineId,
        sourceType: request.sourceType,
        sourceId: request.sourceId,
        movementType: request.movementType,
      },
      select: { id: true },
    });

    if (already !== null) return 'ALREADY_APPLIED';

    try {
      await this.database.unscoped.budgetMovement.create({
        data: {
          id: newId(),
          organizationId: request.organizationId,
          budgetLineId: request.budgetLineId,
          movementType: request.movementType,
          direction: request.direction,
          amount: request.amount.toJSON().amount,
          currency: request.amount.currency,
          sourceType: request.sourceType,
          sourceId: request.sourceId,
          actorMembershipId: getContext()?.membershipId ?? null,
          memo: request.memo ?? null,
        },
      });
    } catch (error) {
      if (isUniqueViolation(error)) return 'ALREADY_APPLIED';
      throw error;
    }

    return 'APPLIED';
  }

  /**
   * Record threshold crossings, once each (FR-BDG-006).
   *
   * The unique index on `(line, threshold)` is the idempotency: a budget that
   * crosses 90 %, is released back under it, and crosses again does **not**
   * announce it twice. That is deliberate — the second message tells a reader
   * nothing they did not already know, and an alert that repeats is an alert
   * people filter.
   */
  private async recordCrossings(
    organizationId: string,
    budgetId: string,
    budgetLineId: string,
    thresholds: readonly number[],
    utilization: number,
  ): Promise<ThresholdCrossing[]> {
    const crossed: ThresholdCrossing[] = [];

    for (const threshold of thresholds) {
      if (utilization < threshold) continue;

      try {
        await this.database.unscoped.budgetAlert.create({
          data: { id: newId(), organizationId, budgetId, budgetLineId, threshold, utilization },
        });
      } catch (error) {
        // Already announced. Nothing to say.
        if (isUniqueViolation(error)) continue;
        throw error;
      }

      crossed.push({ budgetId, budgetLineId, threshold, utilization });
    }

    return crossed;
  }

  /**
   * Every budget line a spend draws on.
   *
   * Matching is by entity, currency, period, and one scope dimension. A budget
   * whose currency differs from the spend's is **not** a match: converting here
   * would put an FX rate inside a control, and the rate that applied when the
   * money moved is not the rate that applies when the budget is read.
   */
  private async matchingLines(
    organizationId: string,
    coordinates: SpendCoordinates,
  ): Promise<{ budget: BudgetRow; line: LineRow }[]> {
    const scopeIds = [
      coordinates.departmentId,
      coordinates.projectId,
      coordinates.categoryId,
    ].filter((value): value is string => typeof value === 'string');

    const budgets = await this.database.unscoped.budget.findMany({
      where: {
        organizationId,
        status: 'ACTIVE',
        entityId: coordinates.entityId,
        currency: coordinates.amount.currency,
        periodStart: { lte: coordinates.occurredAt },
        periodEnd: { gte: coordinates.occurredAt },
        OR: [
          { scopeType: 'ORGANIZATION' },
          { scopeType: 'ENTITY', scopeId: coordinates.entityId },
          ...(scopeIds.length === 0 ? [] : [{ scopeId: { in: scopeIds } }]),
        ],
      },
    });

    const applicable = budgets.filter((budget) => this.scopeMatches(budget, coordinates));
    if (applicable.length === 0) return [];

    const lines = await this.database.unscoped.budgetLine.findMany({
      where: {
        organizationId,
        budgetId: { in: applicable.map((budget) => budget.id) },
        periodStart: { lte: coordinates.occurredAt },
        periodEnd: { gte: coordinates.occurredAt },
      },
    });

    return lines.flatMap((line) => {
      const budget = applicable.find((candidate) => candidate.id === line.budgetId);
      return budget === undefined ? [] : [{ budget, line }];
    });
  }

  /** One dimension, checked against the coordinate that carries it. */
  private scopeMatches(budget: BudgetRow, coordinates: SpendCoordinates): boolean {
    switch (budget.scopeType) {
      case 'ORGANIZATION':
        return true;
      case 'ENTITY':
        return budget.scopeId === coordinates.entityId;
      case 'DEPARTMENT':
        return budget.scopeId === coordinates.departmentId;
      case 'PROJECT':
        return budget.scopeId === coordinates.projectId;
      case 'CATEGORY':
        return budget.scopeId === coordinates.categoryId;
      default:
        return false;
    }
  }

  /** The write path: match, append, re-derive, alert. */
  private async applyAcrossMatches(
    organizationId: string,
    coordinates: SpendCoordinates,
    options: {
      movementType: 'COMMITMENT' | 'ACTUAL' | 'RELEASE';
      direction: 'INCREASE' | 'DECREASE';
      source: { type: BudgetSourceType; id: string };
      releaseCommitment?: boolean;
      memo?: string;
    },
  ): Promise<ThresholdCrossing[]> {
    const matches = await this.matchingLines(organizationId, coordinates);
    if (matches.length === 0) return [];

    const crossings: ThresholdCrossing[] = [];

    for (const { budget, line } of matches) {
      if (line.currency !== coordinates.amount.currency) {
        // Not something a user can fix: it means the matching produced a line
        // in the wrong currency, which is a bug rather than bad input.
        throw new Error(
          `Budget line ${line.id} is in ${line.currency}; the movement is in ${coordinates.amount.currency}.`,
        );
      }

      const outcome = await this.append({
        organizationId,
        budgetLineId: line.id,
        movementType: options.movementType,
        direction: options.direction,
        amount: coordinates.amount,
        sourceType: options.source.type,
        sourceId: options.source.id,
        ...(options.memo === undefined ? {} : { memo: options.memo }),
      });

      if (options.releaseCommitment === true) {
        // Release what this source actually reserved, which is not necessarily
        // what it is now spending: an authorisation for 100 that settles at 97
        // must give back 100, and a posting that never reserved anything must
        // give back nothing at all. Releasing the settled amount instead would
        // drift the committed balance by the difference every time, in
        // whichever direction the merchant happened to round.
        const reserved = await this.database.unscoped.budgetMovement.findFirst({
          where: {
            budgetLineId: line.id,
            sourceType: options.source.type,
            sourceId: options.source.id,
            movementType: 'COMMITMENT',
          },
        });

        if (reserved !== null) {
          await this.append({
            organizationId,
            budgetLineId: line.id,
            movementType: 'RELEASE',
            direction: 'DECREASE',
            amount: Money.of(reserved.amount, reserved.currency),
            sourceType: options.source.type,
            sourceId: options.source.id,
            memo: 'Released by the posting that replaced it.',
          });
        }
      }

      // Always, including for a replay: if an earlier attempt appended and then
      // died before materialising, this is what repairs it.
      await this.materialize(organizationId, line.id);

      if (outcome === 'ALREADY_APPLIED') continue;

      const fresh = await this.database.unscoped.budgetLine.findFirst({ where: { id: line.id } });
      if (fresh === null) continue;

      const allocated = Money.of(fresh.allocatedAmount, fresh.currency);
      const used = Money.of(fresh.committedAmount, fresh.currency).add(
        Money.of(fresh.actualAmount, fresh.currency),
      );
      const utilization = utilizationOf(allocated, used);

      await this.audit.record(this.database.unscoped, {
        organizationId,
        action: `budget.${options.movementType.toLowerCase()}`,
        resourceType: 'budget_line',
        resourceId: line.id,
        ...(getContext()?.membershipId === undefined
          ? { actorType: 'SYSTEM' as const, actorLabel: 'budget-ledger' }
          : {}),
        metadata: {
          budgetId: budget.id,
          amount: coordinates.amount.toJSON().amount,
          currency: coordinates.amount.currency,
          sourceType: options.source.type,
          sourceId: options.source.id,
        },
      });

      if (utilization === null) continue;

      crossings.push(
        ...(await this.recordCrossings(
          organizationId,
          budget.id,
          line.id,
          budget.alertThresholds,
          utilization,
        )),
      );
    }

    return crossings;
  }
}

/** The line moved underneath this write. Retryable, and only ever internal. */
class StaleLineError extends Error {
  constructor() {
    super('The budget line changed between the read and the write.');
    this.name = 'StaleLineError';
  }
}

/**
 * Retry an operation that lost a race.
 *
 * The backoff is jittered because fifty writers retrying in lockstep collide
 * again on the same tick, which turns a contended line into a livelock rather
 * than a queue.
 */
export async function runWithRetry<T>(operation: () => Promise<T>): Promise<T> {
  return withRetry(operation);
}

async function withRetry<T>(operation: () => Promise<T>): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (!isRetryable(error)) throw error;
      lastError = error;
      await sleep(randomInt(Math.min(120, 3 * 2 ** Math.min(attempt, 6))));
    }
  }

  throw lastError;
}

/**
 * Did this attempt lose a race?
 *
 * Three shapes, one meaning. `P2034` is Prisma naming a write conflict;
 * `StaleLineError` is our own version guard reporting the same thing a moment
 * earlier; and an aborted transaction is what MongoDB says when the statement
 * that conflicted took the transaction down with it. A unique violation is
 * deliberately **not** here: retrying it would fail identically forever.
 */
function isRetryable(error: unknown): boolean {
  if (error instanceof StaleLineError) return true;
  if (isUniqueViolation(error)) return false;
  if (isWriteConflict(error)) return true;

  return (
    typeof error === 'object' &&
    error !== null &&
    typeof (error as { message?: unknown }).message === 'string' &&
    /has been aborted|write conflict/i.test((error as { message: string }).message)
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Whole percent of allocation consumed, or `null` when nothing is allocated.
 *
 * `null` rather than `0` or `Infinity`: a budget with no money in it has no
 * utilisation, and every other answer produces a progress bar that lies.
 */
export function utilizationOf(allocated: Money, used: Money): number | null {
  if (!allocated.greaterThan(Money.zero(allocated.currency))) return null;

  return Math.round((Number(used.toJSON().amount) / Number(allocated.toJSON().amount)) * 100);
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === PRISMA_UNIQUE_VIOLATION
  );
}

interface BudgetRow {
  id: string;
  name: string;
  scopeType: string;
  scopeId: string | null;
  alertThresholds: number[];
  overspendBehavior: 'WARN' | 'REQUIRE_APPROVAL' | 'BLOCK';
}

interface LineRow {
  id: string;
  budgetId: string;
  currency: string;
  allocatedAmount: string;
  committedAmount: string;
  actualAmount: string;
  version: number;
}

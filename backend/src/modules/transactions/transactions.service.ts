import type {
  CategorizeTransaction,
  CreateAdjustment,
  ImportResult,
  ImportTransactionRow,
  ImportTransactions,
  BulkReview,
  BulkReviewResult,
  ListTransactionsQuery,
  MatchTransaction,
  ReviewTransaction,
  TransactionDetail,
  TransactionRecord,
} from '@financy/contracts';
import {
  ConflictError,
  Money,
  NotFoundError,
  PostedRecordImmutableError,
  ValidationError,
  newId,
} from '@financy/core';
import type { Prisma } from '@financy/db';
import { Inject, Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';

import { AuditService } from '../../platform/audit/index.js';
import { guardVersion } from '../../platform/concurrency/index.js';
import { DatabaseService } from '../../platform/database/index.js';
import { QUEUE_PORT, type QueuePort } from '../../platform/queue/index.js';
import { callerHas, getContext, getOrganizationId } from '../../platform/request-context/index.js';

/**
 * Transactions (tasks 2.4.5 to 2.4.8).
 *
 * ## The money is immutable once posted; everything about it is not
 *
 * Amount, currency, merchant, and `occurredAt` cannot change on a `POSTED` row,
 * because somebody has already reconciled against them and a correction that
 * rewrote the original would silently change a reported figure. Category,
 * review, and accounting status stay mutable — none of that is the money. A
 * genuine correction is a new `TransactionAdjustment` row that references the
 * original, so the arithmetic still works and the history survives.
 *
 * ## Import is idempotent because of an index, not a check
 *
 * `(organizationId, provider, providerTransactionId)` is unique. Two people
 * importing the same file at the same moment produce one row and one
 * `SKIPPED_DUPLICATE`, which a pre-flight "does it exist?" query would not — it
 * would find nothing twice and insert twice. Every row is reported
 * individually, because "417 imported, 3 already present, 1 failed on row 88"
 * is something somebody can act on and "import complete" is not.
 *
 * ## Auto-match is a guess, and is labelled as one
 *
 * It links a charge to an approved spend request when the amount, the entity,
 * and the timing all line up. It is off unless asked for, it is recorded as
 * `AUTO_MATCHED` rather than `MANUALLY_MATCHED`, and it is reversible — because
 * a guess that quietly consumes somebody's authorisation is worse than no match
 * at all.
 */
@Injectable()
export class TransactionsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
    private readonly logger: PinoLogger,
    @Inject(QUEUE_PORT) private readonly queue: QueuePort,
  ) {}

  async list(query: ListTransactionsQuery): Promise<{ items: TransactionRecord[]; total: number }> {
    const where: Prisma.TransactionWhereInput = {
      ...(query.status === undefined ? {} : { status: query.status }),
      ...(query.reviewStatus === undefined ? {} : { reviewStatus: query.reviewStatus }),
      ...(query.receiptStatus === undefined ? {} : { receiptStatus: query.receiptStatus }),
      ...(query.matchStatus === undefined ? {} : { matchStatus: query.matchStatus }),
      ...(query.cardId === undefined ? {} : { cardId: query.cardId }),
      ...(query.categoryId === undefined ? {} : { categoryId: query.categoryId }),
      ...(query.departmentId === undefined ? {} : { departmentId: query.departmentId }),
      ...(query.q === undefined
        ? {}
        : { merchantName: { contains: query.q, mode: 'insensitive' } }),
      ...(query.from === undefined && query.to === undefined
        ? {}
        : {
            occurredAt: {
              ...(query.from === undefined ? {} : { gte: new Date(query.from) }),
              ...(query.to === undefined ? {} : { lte: new Date(query.to) }),
            },
          }),
      // Without `transaction:read_all`, a caller sees only charges on their own
      // cards. Narrowing silently rather than refusing: the parameter is a view
      // preference, and the scope is decided here regardless of what was asked.
      ...this.visibleToCaller(query.mine === true),
    };

    const [total, rows] = await Promise.all([
      this.database.client.transaction.count({ where }),
      this.database.client.transaction.findMany({
        where,
        select: SELECT,
        orderBy: [{ occurredAt: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);

    return { total, items: rows.map(toRecord) };
  }

  /**
   * One transaction, scoped the same way the list is.
   *
   * **The narrowing is repeated here rather than left to the list**, because a
   * scope enforced only when enumerating is not a scope: an id is guessable
   * from a colleague's screen share, a browser history, or a support ticket,
   * and a detail route that answered for any id in the organisation would hand
   * over what somebody else spent. The refusal is a `404` rather than a `403`
   * for the same reason it is everywhere else — a distinguishable answer is a
   * way to confirm that a transaction exists.
   */
  async get(id: string): Promise<TransactionDetail> {
    const organizationId = requireOrganization();

    const row = await this.database.client.transaction.findFirst({
      where: { id, ...this.visibleToCaller() },
      select: SELECT,
    });

    if (row === null) throw new NotFoundError('Transaction');

    const [adjustments, spendRequest] = await Promise.all([
      this.database.unscoped.transactionAdjustment.findMany({
        where: { organizationId, transactionId: id },
        select: {
          id: true,
          adjustmentType: true,
          amount: true,
          currency: true,
          reason: true,
          createdAt: true,
          createdBy: { select: { user: { select: { fullName: true } } } },
        },
        orderBy: [{ createdAt: 'desc' }],
      }),
      row.spendRequestId === null
        ? Promise.resolve(null)
        : this.database.unscoped.spendRequest.findFirst({
            where: { id: row.spendRequestId, organizationId },
            select: { id: true, reference: true, purpose: true },
          }),
    ]);

    return {
      ...toRecord(row),
      adjustments: adjustments.map((adjustment) => ({
        id: adjustment.id,
        adjustmentType: adjustment.adjustmentType,
        amount: { amount: adjustment.amount, currency: adjustment.currency },
        reason: adjustment.reason,
        createdBy: adjustment.createdBy?.user.fullName ?? null,
        createdAt: adjustment.createdAt.toISOString(),
      })),
      spendRequest,
    };
  }

  /**
   * Code a transaction.
   *
   * Allowed on a posted row, because none of these fields is the money. That
   * distinction is the entire reason the immutability rule is written in terms
   * of specific columns rather than "posted rows are read-only" — a posted
   * transaction that could never be categorised would make the finance review
   * queue impossible.
   */
  async categorize(
    id: string,
    input: CategorizeTransaction,
    expectedVersion: number,
  ): Promise<TransactionDetail> {
    const organizationId = requireOrganization();

    await this.database.unscoped.$transaction(async (tx) => {
      const before = await tx.transaction.findFirst({
        where: { id, organizationId, ...this.visibleToCaller() },
        select: SELECT,
      });

      if (before === null) throw new NotFoundError('Transaction');

      guardVersion('Transaction', expectedVersion, before.version);

      await this.assertClassificationIsOurs(tx, organizationId, input);

      const after = await tx.transaction.update({
        where: { id, version: expectedVersion },
        data: {
          ...(input.categoryId === undefined ? {} : { categoryId: input.categoryId }),
          ...(input.departmentId === undefined ? {} : { departmentId: input.departmentId }),
          ...(input.projectId === undefined ? {} : { projectId: input.projectId }),
          ...(input.memo === undefined ? {} : { memo: input.memo }),
          // Coding it is what makes it mappable. Leaving `accountingStatus` at
          // `UNMAPPED` after a category was set would keep it in the unmapped
          // queue forever, which is how that queue stops being trusted.
          ...(input.categoryId === undefined || input.categoryId === null
            ? {}
            : { accountingStatus: 'MAPPED' as const }),
          version: { increment: 1 },
        },
        select: SELECT,
      });

      await this.audit.record(tx, {
        action: 'transaction.categorized',
        resourceType: 'transaction',
        resourceId: id,
        before: { categoryId: before.categoryId, departmentId: before.departmentId },
        after: { categoryId: after.categoryId, departmentId: after.departmentId },
      });
    });

    return this.get(id);
  }

  async review(
    id: string,
    input: ReviewTransaction,
    expectedVersion: number,
  ): Promise<TransactionDetail> {
    const organizationId = requireOrganization();
    const reviewer = getContext()?.membershipId ?? null;

    await this.database.unscoped.$transaction(async (tx) => {
      const before = await tx.transaction.findFirst({
        where: { id, organizationId, ...this.visibleToCaller() },
        select: SELECT,
      });

      if (before === null) throw new NotFoundError('Transaction');

      guardVersion('Transaction', expectedVersion, before.version);

      if (before.status === 'PENDING') {
        // Reviewing an authorisation that has not settled is reviewing a figure
        // that can still change. The queue is built on posted rows for exactly
        // this reason.
        throw new ConflictError(
          'This has not settled yet. Its amount can still change, so there is nothing final to review.',
        );
      }

      await tx.transaction.update({
        where: { id, version: expectedVersion },
        data: {
          reviewStatus: input.reviewStatus,
          reviewNote: input.note ?? null,
          // Stamped only on a terminal review outcome. `IN_REVIEW` means
          // somebody has picked it up, not that they have finished, and
          // recording a completion time for it would make the queue's ageing
          // meaningless.
          ...(input.reviewStatus === 'IN_REVIEW'
            ? {}
            : { reviewedByMembershipId: reviewer, reviewedAt: new Date() }),
          version: { increment: 1 },
        },
      });

      await this.audit.record(tx, {
        action: 'transaction.reviewed',
        resourceType: 'transaction',
        resourceId: id,
        before: { reviewStatus: before.reviewStatus },
        after: { reviewStatus: input.reviewStatus, note: input.note ?? null },
      });
    });

    return this.get(id);
  }

  /**
   * Link a charge to the request that authorised it, or say there was none.
   *
   * A manual match overrides an automatic one and is recorded as manual, so the
   * record distinguishes a decision from a guess. `notApplicable` is a
   * first-class answer rather than leaving the row `UNMATCHED` forever — "this
   * was a genuine unplanned purchase" is a conclusion, and a queue that cannot
   * express it never empties.
   */
  async match(
    id: string,
    input: MatchTransaction,
    expectedVersion: number,
  ): Promise<TransactionDetail> {
    const organizationId = requireOrganization();

    await this.database.unscoped.$transaction(async (tx) => {
      const before = await tx.transaction.findFirst({
        where: { id, organizationId, ...this.visibleToCaller() },
        select: SELECT,
      });

      if (before === null) throw new NotFoundError('Transaction');

      guardVersion('Transaction', expectedVersion, before.version);

      if (input.spendRequestId !== null) {
        const request = await tx.spendRequest.findFirst({
          where: { id: input.spendRequestId, organizationId },
          select: { id: true, status: true },
        });

        if (request === null) throw new NotFoundError('Spend request');

        if (request.status !== 'APPROVED') {
          throw new ConflictError(
            'That request was not approved, so this charge cannot be recorded against it.',
          );
        }
      }

      await tx.transaction.update({
        where: { id, version: expectedVersion },
        data: {
          spendRequestId: input.spendRequestId,
          matchStatus:
            input.spendRequestId !== null
              ? 'MANUALLY_MATCHED'
              : input.notApplicable
                ? 'NOT_APPLICABLE'
                : 'UNMATCHED',
          version: { increment: 1 },
        },
      });

      await this.audit.record(tx, {
        action: 'transaction.matched',
        resourceType: 'transaction',
        resourceId: id,
        before: {
          spendRequestId: before.spendRequestId,
          matchStatus: before.matchStatus,
        },
        after: { spendRequestId: input.spendRequestId },
      });
    });

    return this.get(id);
  }

  /**
   * Correct a posted transaction, as a new row.
   *
   * Never an edit. The original figure has been reconciled against, and
   * rewriting it would silently change a number somebody has already reported.
   */
  async adjust(id: string, input: CreateAdjustment): Promise<TransactionDetail> {
    const organizationId = requireOrganization();
    const actor = getContext()?.membershipId ?? null;

    await this.database.unscoped.$transaction(async (tx) => {
      const transaction = await tx.transaction.findFirst({
        where: { id, organizationId, ...this.visibleToCaller() },
        select: { id: true, status: true, currency: true },
      });

      if (transaction === null) throw new NotFoundError('Transaction');

      if (transaction.status !== 'POSTED') {
        throw new ConflictError(
          'Only a settled transaction can be adjusted. A pending one can still change on its own.',
        );
      }

      if (input.amount.currency !== transaction.currency) {
        // Refused rather than converted. An adjustment in another currency
        // would need a rate, and a rate nobody recorded is a correction nobody
        // can check.
        throw new ValidationError({
          amount: [
            `This transaction is in ${transaction.currency}. An adjustment has to be in the same currency.`,
          ],
        });
      }

      await tx.transactionAdjustment.create({
        data: {
          id: newId(),
          organizationId,
          transactionId: id,
          adjustmentType: input.adjustmentType,
          amount: Money.of(input.amount.amount, input.amount.currency).toString(),
          currency: input.amount.currency,
          reason: input.reason,
          createdByMembershipId: actor,
        },
      });

      await this.audit.record(tx, {
        action: 'transaction.adjusted',
        resourceType: 'transaction',
        resourceId: id,
        after: {
          adjustmentType: input.adjustmentType,
          amount: input.amount.amount,
          currency: input.amount.currency,
          reason: input.reason,
        },
      });
    });

    return this.get(id);
  }

  /**
   * Import a batch, idempotently, reporting per row.
   *
   * **Each row is its own transaction.** One malformed row out of five hundred
   * must not roll back the other four hundred and ninety-nine — a person
   * re-importing after fixing line 88 would then create duplicates of
   * everything else, except that the unique index refuses them, which turns a
   * recoverable situation into a confusing one. Per-row isolation keeps "fix
   * the one bad line and run it again" the obvious repair.
   */
  async import(input: ImportTransactions): Promise<ImportResult> {
    const organizationId = requireOrganization();
    const rows: ImportResult['rows'] = [];

    let imported = 0;
    let skipped = 0;
    let failed = 0;
    let matched = 0;

    /** Charges that moved money, collected for the budget jobs below. */
    const posted: { transactionId: string; matchedSpendRequestId: string | null }[] = [];

    for (const [index, row] of input.rows.entries()) {
      try {
        const outcome = await this.importRow(organizationId, input.provider, row, input.autoMatch);

        rows.push({ index, providerTransactionId: row.providerTransactionId, ...outcome });

        if (outcome.outcome === 'IMPORTED') imported += 1;
        if (outcome.outcome === 'SKIPPED_DUPLICATE') skipped += 1;
        if (outcome.matchedSpendRequestId !== null) matched += 1;

        // Only a posted charge is money that left. A pending authorisation may
        // still be reversed, and recording it as an actual would make a budget
        // read as spent for a charge that never settled.
        if (outcome.outcome === 'IMPORTED' && row.status === 'POSTED' && outcome.transactionId !== null) {
          posted.push({
            transactionId: outcome.transactionId,
            matchedSpendRequestId: outcome.matchedSpendRequestId,
          });
        }
      } catch (error) {
        failed += 1;

        rows.push({
          index,
          providerTransactionId: row.providerTransactionId,
          outcome: 'FAILED',
          transactionId: null,
          matchedSpendRequestId: null,
          // The message a person can act on, not a stack. A row that failed
          // because its entity is archived needs to say so by name.
          message: error instanceof Error ? error.message : 'This row could not be imported.',
        });

        this.logger.warn(
          { index, providerTransactionId: row.providerTransactionId, err: error },
          'A transaction import row failed.',
        );
      }
    }

    // One audit event for the batch, not one per row. Five hundred events for
    // one action is a trail nobody can read; the counts and the provider are
    // what an investigation actually starts from.
    await this.database.unscoped.$transaction(async (tx) => {
      await this.audit.record(tx, {
        action: 'transaction.imported',
        resourceType: 'transaction',
        metadata: {
          provider: input.provider,
          total: input.rows.length,
          imported,
          skipped,
          failed,
          matched,
          autoMatch: input.autoMatch,
        },
      });
    });

    await this.moveBudgets(organizationId, posted);

    return { imported, skipped, failed, matched, rows };
  }

  /**
   * Record what posted charges did to their budgets (FR-TXN-008).
   *
   * **Two movements per matched charge, not one.** The charge records an
   * actual, and the request it fulfils gives back the commitment that was made
   * when it was approved — otherwise the same money sits in `committed` and in
   * `actual` at once, and the budget reads as twice as spent for the rest of
   * the period.
   *
   * Enqueued after the import rather than inside it: the ledger is idempotent
   * by source, so a redelivery is free, while a movement written inside a
   * transaction that rolled back is a balance nobody can explain.
   */
  private async moveBudgets(
    organizationId: string,
    posted: readonly { transactionId: string; matchedSpendRequestId: string | null }[],
  ): Promise<void> {
    for (const charge of posted) {
      await this.queue.enqueue(
        'budget.apply',
        {
          organizationId,
          operation: 'ACTUALIZE',
          sourceType: 'TRANSACTION',
          sourceId: charge.transactionId,
        },
        { idempotencyKey: `budget:TRANSACTION:${charge.transactionId}:ACTUALIZE` },
      );

      if (charge.matchedSpendRequestId === null) continue;

      await this.queue.enqueue(
        'budget.apply',
        {
          organizationId,
          operation: 'RELEASE',
          sourceType: 'SPEND_REQUEST',
          sourceId: charge.matchedSpendRequestId,
        },
        { idempotencyKey: `budget:SPEND_REQUEST:${charge.matchedSpendRequestId}:RELEASE` },
      );
    }
  }

  /**
   * Review many at once (task 3.4).
   *
   * **Per-row outcomes, not a count.** Twenty charges reviewed together and
   * three refused because they have not settled is a thing finance can act on;
   * "17 reviewed" is not. Each is applied in its own transaction so one
   * refusal does not roll back the other nineteen — the same reasoning as the
   * import, and the same reason the response names what it skipped.
   */
  async bulkReview(input: BulkReview): Promise<BulkReviewResult> {
    const organizationId = requireOrganization();
    const reviewer = getContext()?.membershipId ?? null;

    const skipped: BulkReviewResult['skipped'] = [];
    let reviewed = 0;

    for (const transactionId of input.transactionIds) {
      const outcome = await this.database.unscoped.$transaction(async (tx) => {
        const before = await tx.transaction.findFirst({
          where: { id: transactionId, organizationId, ...this.visibleToCaller() },
          select: { id: true, status: true, version: true },
        });

        if (before === null) return 'That charge does not exist, or is not yours to review.';

        if (before.status === 'PENDING') {
          return 'It has not settled yet, so there is nothing final to review.';
        }

        await tx.transaction.update({
          where: { id: transactionId, version: before.version },
          data: {
            reviewStatus: input.reviewStatus,
            reviewNote: input.note ?? null,
            ...(input.reviewStatus === 'IN_REVIEW'
              ? {}
              : { reviewedByMembershipId: reviewer, reviewedAt: new Date() }),
            version: { increment: 1 },
          },
        });

        await this.audit.record(tx, {
          action: 'transaction.reviewed',
          resourceType: 'transaction',
          resourceId: transactionId,
          after: { reviewStatus: input.reviewStatus, bulk: true },
        });

        return null;
      });

      if (outcome === null) reviewed += 1;
      else skipped.push({ transactionId, reason: outcome });
    }

    return { reviewed, skipped };
  }

  // ── internals ────────────────────────────────────────────────────────────

  /**
   * The clause that narrows a read to what this caller may see.
   *
   * **Derived from the caller's permissions here, not passed in by the
   * controller.** A scope supplied as an argument is one a route can forget to
   * supply, and the failure is silent in the worst direction — a new endpoint
   * that omits it shows everybody's spending and looks like it works. There is
   * exactly one place that decides, and every read goes through it.
   *
   * `mine` narrows a caller who *could* see everything, which is a view
   * preference; the absence of `transaction:read_all` narrows regardless of
   * what was asked for, which is the scope.
   */
  private visibleToCaller(mine = false): Prisma.TransactionWhereInput {
    const membershipId = getContext()?.membershipId;

    if (membershipId === undefined) return {};
    if (callerHas('transaction:read_all') && !mine) return {};

    return { memberMembershipId: membershipId };
  }

  private async importRow(
    organizationId: string,
    provider: string,
    row: ImportTransactionRow,
    autoMatch: boolean,
  ): Promise<Omit<ImportResult['rows'][number], 'index' | 'providerTransactionId'>> {
    return this.database.unscoped.$transaction(async (tx) => {
      // Checked first for a useful *answer*; the unique index below is what
      // makes it correct under two simultaneous imports. Both, because the
      // check alone races and the index alone cannot say which row was a
      // duplicate of what.
      const existing = await tx.transaction.findFirst({
        where: { organizationId, provider, providerTransactionId: row.providerTransactionId },
        select: { id: true },
      });

      if (existing !== null) {
        return {
          outcome: 'SKIPPED_DUPLICATE' as const,
          transactionId: existing.id,
          matchedSpendRequestId: null,
          message: 'Already imported.',
        };
      }

      const entity = await tx.entity.findFirst({
        where: { id: row.entityId, organizationId },
        select: { id: true, status: true },
      });

      if (entity === null) throw new NotFoundError('Entity');

      if (entity.status !== 'ACTIVE') {
        throw new ConflictError('That entity is archived, so spend cannot be recorded against it.');
      }

      const card =
        row.cardId === undefined || row.cardId === null
          ? null
          : await tx.card.findFirst({
              where: { id: row.cardId, organizationId },
              select: { id: true, holderMembershipId: true, departmentId: true, categoryId: true },
            });

      if (row.cardId !== undefined && row.cardId !== null && card === null) {
        throw new NotFoundError('Card');
      }

      const amount = Money.of(row.amount.amount, row.amount.currency);
      const occurredAt = new Date(row.occurredAt);

      const match = autoMatch
        ? await this.findMatch(tx, organizationId, amount, row.entityId, occurredAt)
        : null;

      const id = newId();

      await tx.transaction.create({
        data: {
          id,
          organizationId,
          entityId: row.entityId,
          cardId: card?.id ?? null,
          // Inherited from the card rather than required on the row. The
          // importer knows which card was charged; making the file also carry
          // the holder and the department is asking it to repeat what this
          // system already knows, and to get it wrong.
          memberMembershipId: card?.holderMembershipId ?? null,
          departmentId: card?.departmentId ?? null,
          categoryId: card?.categoryId ?? null,
          spendRequestId: match?.id ?? null,
          merchantName: row.merchantName,
          merchantRaw: row.merchantRaw ?? null,
          amount: amount.toString(),
          currency: amount.currency,
          source: 'IMPORT',
          status: row.status,
          receiptStatus: 'MISSING',
          reviewStatus: 'PENDING',
          accountingStatus: card?.categoryId == null ? 'UNMAPPED' : 'MAPPED',
          matchStatus: match === null ? 'UNMATCHED' : 'AUTO_MATCHED',
          memo: row.memo ?? null,
          occurredAt,
          postedAt:
            row.postedAt === undefined || row.postedAt === null ? null : new Date(row.postedAt),
          provider,
          providerTransactionId: row.providerTransactionId,
        },
      });

      return {
        outcome: 'IMPORTED' as const,
        transactionId: id,
        matchedSpendRequestId: match?.id ?? null,
        message: null,
      };
    });
  }

  /**
   * The approved request this charge most likely fulfils.
   *
   * Three conditions, all of them required, and the conjunction is what keeps
   * this from being noise: the **same entity**, the **same amount and
   * currency**, and an approval **within a sensible window** of the charge.
   * Matching on amount alone would link a €12 coffee to whichever of forty
   * requests happened to be for €12.
   *
   * Ambiguity is resolved by refusing. If two approved requests fit equally
   * well, nothing is matched — an automatic guess between two candidates is the
   * one that gets it wrong silently, and leaving it for a human costs a click.
   */
  private async findMatch(
    tx: Prisma.TransactionClient,
    organizationId: string,
    amount: Money,
    entityId: string,
    occurredAt: Date,
  ): Promise<{ id: string } | null> {
    const window = 60 * 86_400_000;

    const candidates = await tx.spendRequest.findMany({
      where: {
        organizationId,
        entityId,
        status: 'APPROVED',
        decidedAt: {
          gte: new Date(occurredAt.getTime() - window),
          lte: new Date(occurredAt.getTime() + 86_400_000),
        },
      },
      select: { id: true, amount: true, currency: true },
    });

    const exact = candidates.filter(
      (candidate) =>
        candidate.currency === amount.currency &&
        Money.of(candidate.amount, candidate.currency).equals(amount),
    );

    // Already-consumed requests are excluded, so one authorisation cannot cover
    // two charges. Without this a duplicate import against a fixed file would
    // match the same request twice and look reconciled.
    const unconsumed: { id: string }[] = [];

    for (const candidate of exact) {
      const used = await tx.transaction.findFirst({
        where: { organizationId, spendRequestId: candidate.id },
        select: { id: true },
      });

      if (used === null) unconsumed.push({ id: candidate.id });
    }

    return unconsumed.length === 1 ? (unconsumed[0] ?? null) : null;
  }

  private async assertClassificationIsOurs(
    tx: Prisma.TransactionClient,
    organizationId: string,
    input: CategorizeTransaction,
  ): Promise<void> {
    if (input.categoryId !== undefined && input.categoryId !== null) {
      const category = await tx.category.findFirst({
        where: { id: input.categoryId, organizationId },
        select: { id: true },
      });

      if (category === null) throw new NotFoundError('Category');
    }

    if (input.departmentId !== undefined && input.departmentId !== null) {
      const department = await tx.department.findFirst({
        where: { id: input.departmentId, organizationId },
        select: { id: true },
      });

      if (department === null) throw new NotFoundError('Department');
    }

    if (input.projectId !== undefined && input.projectId !== null) {
      const project = await tx.project.findFirst({
        where: { id: input.projectId, organizationId },
        select: { id: true },
      });

      if (project === null) throw new NotFoundError('Project');
    }
  }
}

const SELECT = {
  id: true,
  entityId: true,
  cardId: true,
  memberMembershipId: true,
  departmentId: true,
  projectId: true,
  categoryId: true,
  spendRequestId: true,
  merchantName: true,
  merchantRaw: true,
  amount: true,
  currency: true,
  billingAmount: true,
  billingCurrency: true,
  source: true,
  status: true,
  receiptStatus: true,
  reviewStatus: true,
  accountingStatus: true,
  matchStatus: true,
  memo: true,
  occurredAt: true,
  postedAt: true,
  reviewedAt: true,
  reviewNote: true,
  provider: true,
  providerTransactionId: true,
  createdAt: true,
  version: true,
  card: { select: { id: true, name: true, lastFour: true } },
  member: { select: { user: { select: { fullName: true } } } },
  reviewedBy: { select: { user: { select: { fullName: true } } } },
} as const;

interface Row {
  id: string;
  entityId: string;
  cardId: string | null;
  memberMembershipId: string | null;
  departmentId: string | null;
  projectId: string | null;
  categoryId: string | null;
  spendRequestId: string | null;
  merchantName: string;
  merchantRaw: string | null;
  amount: string;
  currency: string;
  billingAmount: string | null;
  billingCurrency: string | null;
  source: string;
  status: string;
  receiptStatus: string;
  reviewStatus: string;
  accountingStatus: string;
  matchStatus: string;
  memo: string | null;
  occurredAt: Date;
  postedAt: Date | null;
  reviewedAt: Date | null;
  reviewNote: string | null;
  provider: string;
  providerTransactionId: string;
  createdAt: Date;
  version: number;
  card: { id: string; name: string; lastFour: string | null } | null;
  member: { user: { fullName: string } } | null;
  reviewedBy: { user: { fullName: string } } | null;
}

function toRecord(row: Row): TransactionRecord {
  return {
    id: row.id,
    entityId: row.entityId,
    cardId: row.cardId,
    card: row.card,
    member:
      row.memberMembershipId === null || row.member === null
        ? null
        : { membershipId: row.memberMembershipId, fullName: row.member.user.fullName },
    departmentId: row.departmentId,
    projectId: row.projectId,
    categoryId: row.categoryId,
    spendRequestId: row.spendRequestId,
    merchantName: row.merchantName,
    merchantRaw: row.merchantRaw,
    amount: { amount: row.amount, currency: row.currency },
    billingAmount:
      row.billingAmount === null || row.billingCurrency === null
        ? null
        : { amount: row.billingAmount, currency: row.billingCurrency },
    source: row.source as TransactionRecord['source'],
    status: row.status as TransactionRecord['status'],
    receiptStatus: row.receiptStatus as TransactionRecord['receiptStatus'],
    reviewStatus: row.reviewStatus as TransactionRecord['reviewStatus'],
    accountingStatus: row.accountingStatus as TransactionRecord['accountingStatus'],
    matchStatus: row.matchStatus as TransactionRecord['matchStatus'],
    memo: row.memo,
    occurredAt: row.occurredAt.toISOString(),
    postedAt: row.postedAt?.toISOString() ?? null,
    reviewedBy: row.reviewedBy?.user.fullName ?? null,
    reviewedAt: row.reviewedAt?.toISOString() ?? null,
    reviewNote: row.reviewNote,
    provider: row.provider,
    providerTransactionId: row.providerTransactionId,
    createdAt: row.createdAt.toISOString(),
    version: row.version,
  };
}

function requireOrganization(): string {
  const organizationId = getOrganizationId();

  if (organizationId === undefined) {
    throw new Error('Transactions cannot be read or written without a tenant context.');
  }

  return organizationId;
}

/** Re-exported so the controller can name the refusal it maps to a 409. */
export { PostedRecordImmutableError };

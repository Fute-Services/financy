import type {
  CardDetail,
  CardRecord,
  ChangeCardStatus,
  IssueCard,
  ListCardsQuery,
  SetCardLimit,
  UpdateCard,
} from '@financy/contracts';
import {
  ConflictError,
  InvalidStateTransitionError,
  Money,
  NotFoundError,
  newId,
} from '@financy/core';
import type { Prisma } from '@financy/db';
import { Inject, Injectable } from '@nestjs/common';

import { AuditService } from '../../platform/audit/index.js';
import { guardVersion } from '../../platform/concurrency/index.js';
import { DatabaseService } from '../../platform/database/index.js';
import { callerHas, getContext, getOrganizationId } from '../../platform/request-context/index.js';
import { CARD_PROVIDER, type CardProvider } from './card-provider.js';

/**
 * Cards (tasks 2.4.1, 2.4.3, 2.4.4).
 *
 * ## The provider is called inside the transaction, and that is a compromise
 *
 * Issuing writes a row and asks an external system for a credential, and the
 * two cannot be made atomic. The order here is: write the card as `PENDING`,
 * call the provider, record what came back. If the provider call fails the
 * transaction rolls back and no card exists — which is the right outcome for
 * this failure. If it *succeeds* and the commit then fails, a credential exists
 * at the issuer that this system does not know about; that is an orphan the
 * reconciliation job in Phase 5 is for, and it is written down here rather than
 * discovered later.
 *
 * ## The limit lives in two places on purpose
 *
 * `card_limits` is the record — append-only, one row per change, with the
 * reason. `cards.limitAmount` is a cache of the newest row, written in the same
 * transaction, so a list of two hundred cards is one query rather than two
 * hundred. The direction of truth is one-way: nothing reads the cache to decide
 * anything, and nothing writes it without writing the row.
 *
 * ## Freezing and terminating are different operations
 *
 * Freezing is reversible; termination is not, because the issuer has destroyed
 * the credential. A single "deactivate" doing whichever seemed appropriate is
 * how a card somebody would have found in an hour gets thrown away, so the two
 * are separate methods with separate permissions and separate audit actions.
 */
@Injectable()
export class CardsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
    @Inject(CARD_PROVIDER) private readonly provider: CardProvider,
  ) {}

  async list(query: ListCardsQuery): Promise<{ items: CardRecord[]; total: number }> {
    const where: Prisma.CardWhereInput = {
      ...(query.status === undefined ? {} : { status: query.status }),
      ...(query.holderMembershipId === undefined
        ? {}
        : { holderMembershipId: query.holderMembershipId }),
      // Somebody without `card:read_all` sees their own, whatever they asked
      // for. Narrowing silently rather than 403-ing: the parameter is a view
      // preference, not a request for named data.
      ...this.visibleToCaller(query.mine === true),
      ...(query.q === undefined ? {} : { name: { contains: query.q, mode: 'insensitive' } }),
    };

    const [total, rows] = await Promise.all([
      this.database.client.card.count({ where }),
      this.database.client.card.findMany({
        where,
        select: CARD_SELECT,
        orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);

    return { total, items: rows.map(toRecord) };
  }

  /**
   * One card, scoped the same way the list is.
   *
   * A scope enforced only when enumerating is not a scope. Card ids travel —
   * in a support ticket, a shared screen, a browser history — and a detail
   * route that answered for any id in the organisation would show one person
   * their colleague's limit and what has been spent against it.
   */
  async get(id: string): Promise<CardDetail> {
    const organizationId = requireOrganization();

    const card = await this.database.client.card.findFirst({
      where: { id, ...this.visibleToCaller() },
      select: CARD_SELECT,
    });

    if (card === null) throw new NotFoundError('Card');

    const [history, spend] = await Promise.all([
      this.database.unscoped.cardLimit.findMany({
        where: { organizationId, cardId: id },
        select: {
          id: true,
          amount: true,
          currency: true,
          period: true,
          reason: true,
          effectiveFrom: true,
          setBy: { select: { user: { select: { fullName: true } } } },
        },
        orderBy: [{ effectiveFrom: 'desc' }],
      }),
      this.spentInPeriod(organizationId, id, card.limitPeriod, card.limitCurrency),
    ]);

    return {
      ...toRecord(card),
      limitHistory: history.map((row) => ({
        id: row.id,
        amount: row.amount,
        currency: row.currency,
        period: row.period,
        reason: row.reason,
        setBy: row.setBy?.user.fullName ?? null,
        effectiveFrom: row.effectiveFrom.toISOString(),
      })),
      spentInPeriod: { amount: spend.total.toString(), currency: spend.total.currency },
      transactionCount: spend.count,
    };
  }

  async issue(input: IssueCard): Promise<CardDetail> {
    const organizationId = requireOrganization();
    const actor = getContext()?.membershipId ?? null;

    const cardId = await this.database.unscoped.$transaction(async (tx) => {
      const holder = await tx.membership.findFirst({
        where: { id: input.holderMembershipId, organizationId, status: 'ACTIVE' },
        select: { id: true, user: { select: { fullName: true } } },
      });

      if (holder === null) throw new NotFoundError('Membership');

      await this.assertEntityIsOurs(tx, organizationId, input.entityId);
      await this.assertDepartmentIsOurs(tx, organizationId, input.departmentId ?? null);

      const id = newId();
      const limit = Money.of(input.limit.amount, input.limit.currency);

      // Asked for before the row is written, so a provider that refuses leaves
      // nothing behind. The reverse order would leave a `PENDING` card that
      // will never become active and that nobody can explain.
      const issued = await this.provider.issue({
        organizationId,
        cardId: id,
        holderName: holder.user.fullName,
        cardType: input.cardType,
        limitAmount: limit.toString(),
        limitCurrency: limit.currency,
        limitPeriod: input.limitPeriod,
      });

      await tx.card.create({
        data: {
          id,
          organizationId,
          name: input.name,
          cardType: input.cardType,
          status: issued.status,
          holderMembershipId: input.holderMembershipId,
          entityId: input.entityId,
          departmentId: input.departmentId ?? null,
          projectId: input.projectId ?? null,
          categoryId: input.categoryId ?? null,
          limitAmount: limit.toString(),
          limitCurrency: limit.currency,
          limitPeriod: input.limitPeriod,
          provider: this.provider.name,
          providerCardId: issued.providerCardId,
          lastFour: issued.lastFour,
          expiryMonth: issued.expiryMonth,
          expiryYear: issued.expiryYear,
          validFrom: new Date(),
          validUntil:
            input.validUntil === undefined || input.validUntil === null
              ? null
              : new Date(input.validUntil),
        },
      });

      // The opening limit is a limit change like any other, so it gets a row.
      // Without it the history starts at the first *edit* and the question
      // "what was it issued with?" has no answer.
      await tx.cardLimit.create({
        data: {
          id: newId(),
          organizationId,
          cardId: id,
          amount: limit.toString(),
          currency: limit.currency,
          period: input.limitPeriod,
          reason: 'Issued with this limit.',
          setByMembershipId: actor,
        },
      });

      await this.audit.record(tx, {
        action: 'card.issued',
        resourceType: 'card',
        resourceId: id,
        after: {
          name: input.name,
          holderMembershipId: input.holderMembershipId,
          limit: limit.toString(),
          currency: limit.currency,
          period: input.limitPeriod,
          provider: this.provider.name,
        },
      });

      return id;
    });

    return this.get(cardId);
  }

  async update(id: string, input: UpdateCard, expectedVersion: number): Promise<CardDetail> {
    const organizationId = requireOrganization();

    await this.database.unscoped.$transaction(async (tx) => {
      const before = await tx.card.findFirst({
        where: { id, organizationId, ...this.visibleToCaller() },
        select: CARD_SELECT,
      });

      if (before === null) throw new NotFoundError('Card');

      guardVersion('Card', expectedVersion, before.version);

      if (before.status === 'TERMINATED') {
        throw new ConflictError('A terminated card cannot be edited.');
      }

      await this.assertDepartmentIsOurs(tx, organizationId, input.departmentId ?? null);

      const after = await tx.card.update({
        where: { id, version: expectedVersion },
        data: {
          ...(input.name === undefined ? {} : { name: input.name }),
          ...(input.departmentId === undefined ? {} : { departmentId: input.departmentId }),
          ...(input.projectId === undefined ? {} : { projectId: input.projectId }),
          ...(input.categoryId === undefined ? {} : { categoryId: input.categoryId }),
          ...(input.validUntil === undefined
            ? {}
            : { validUntil: input.validUntil === null ? null : new Date(input.validUntil) }),
          version: { increment: 1 },
        },
        select: CARD_SELECT,
      });

      await this.audit.record(tx, {
        action: 'card.updated',
        resourceType: 'card',
        resourceId: id,
        before: { name: before.name, departmentId: before.departmentId },
        after: { name: after.name, departmentId: after.departmentId },
      });
    });

    return this.get(id);
  }

  /**
   * Change the limit.
   *
   * A row, then the cache, then the provider — in that order inside one
   * transaction. If the provider refuses, nothing is written and the card keeps
   * the limit it had; the alternative order leaves this system believing a
   * limit the issuer never accepted, which is the worst of the three outcomes
   * because it is the one nobody notices.
   */
  async setLimit(id: string, input: SetCardLimit, expectedVersion: number): Promise<CardDetail> {
    const organizationId = requireOrganization();
    const actor = getContext()?.membershipId ?? null;
    const limit = Money.of(input.limit.amount, input.limit.currency);

    await this.database.unscoped.$transaction(async (tx) => {
      const before = await tx.card.findFirst({
        where: { id, organizationId, ...this.visibleToCaller() },
        select: CARD_SELECT,
      });

      if (before === null) throw new NotFoundError('Card');

      guardVersion('Card', expectedVersion, before.version);

      if (before.status === 'TERMINATED') {
        throw new ConflictError('A terminated card has no limit to change.');
      }

      if (before.providerCardId !== null) {
        await this.provider.setLimit(
          before.providerCardId,
          limit.toString(),
          limit.currency,
          input.limitPeriod,
        );
      }

      await tx.cardLimit.create({
        data: {
          id: newId(),
          organizationId,
          cardId: id,
          amount: limit.toString(),
          currency: limit.currency,
          period: input.limitPeriod,
          reason: input.reason,
          setByMembershipId: actor,
        },
      });

      await tx.card.update({
        where: { id, version: expectedVersion },
        data: {
          limitAmount: limit.toString(),
          limitCurrency: limit.currency,
          limitPeriod: input.limitPeriod,
          version: { increment: 1 },
        },
      });

      await this.audit.record(tx, {
        action: 'card.limit_changed',
        resourceType: 'card',
        resourceId: id,
        before: {
          amount: before.limitAmount,
          currency: before.limitCurrency,
          period: before.limitPeriod,
        },
        after: {
          amount: limit.toString(),
          currency: limit.currency,
          period: input.limitPeriod,
          reason: input.reason,
        },
      });
    });

    return this.get(id);
  }

  /**
   * Freeze, unfreeze, or terminate.
   *
   * One method because the three share a transaction shape, three route-level
   * permissions because they are three different powers — and a terminated card
   * is refused every transition, which is what makes termination mean what the
   * word says.
   */
  async changeStatus(
    id: string,
    target: 'ACTIVE' | 'FROZEN' | 'TERMINATED',
    input: ChangeCardStatus,
    expectedVersion: number,
  ): Promise<CardDetail> {
    const organizationId = requireOrganization();

    await this.database.unscoped.$transaction(async (tx) => {
      const before = await tx.card.findFirst({
        where: { id, organizationId, ...this.visibleToCaller() },
        select: CARD_SELECT,
      });

      if (before === null) throw new NotFoundError('Card');

      guardVersion('Card', expectedVersion, before.version);

      if (before.status === 'TERMINATED') {
        // The provider has destroyed the credential. Allowing a transition out
        // of this would produce a card that looks alive and declines every
        // charge, which is worse for the holder than a card that says it is
        // gone.
        throw new ConflictError(
          'This card was terminated. Termination is permanent — issue a new card instead.',
        );
      }

      if (before.status === target) {
        throw new InvalidStateTransitionError('Card', before.status, target);
      }

      if (before.providerCardId !== null) {
        if (target === 'FROZEN') await this.provider.freeze(before.providerCardId);
        if (target === 'ACTIVE') await this.provider.unfreeze(before.providerCardId);
        if (target === 'TERMINATED') await this.provider.terminate(before.providerCardId);
      }

      await tx.card.update({
        where: { id, version: expectedVersion },
        data: {
          status: target,
          statusReason: input.reason,
          version: { increment: 1 },
        },
      });

      await this.audit.record(tx, {
        action: STATUS_AUDIT_ACTIONS[target],
        resourceType: 'card',
        resourceId: id,
        before: { status: before.status },
        after: { status: target, reason: input.reason },
      });
    });

    return this.get(id);
  }

  // ── internals ────────────────────────────────────────────────────────────

  /**
   * The clause that narrows a read to the cards this caller may see.
   *
   * **Derived from the caller's permissions here, not passed in by the
   * controller.** A scope handed in as an argument is one a route can forget
   * to hand in, and that failure is silent in the worst direction: the new
   * endpoint shows every card in the organisation and looks like it works.
   *
   * `mine` narrows somebody who *could* see everything — a view preference.
   * The absence of `card:read_all` narrows regardless of what was asked for —
   * that is the scope, and it also gates the writes, because a card somebody
   * cannot see is not one they may freeze.
   */
  private visibleToCaller(mine = false): Prisma.CardWhereInput {
    const membershipId = getContext()?.membershipId;

    if (membershipId === undefined) return {};
    if (callerHas('card:read_all') && !mine) return {};

    return { holderMembershipId: membershipId };
  }

  /**
   * What has been spent on this card in its current limit period.
   *
   * Computed here rather than in the browser. A "spent so far" figure derived
   * from a page of twenty-five transactions is a figure taken from a sample and
   * presented as a total — the failure docs/19 forbids by name.
   *
   * Only `POSTED` charges count. A pending authorisation may still change or
   * lapse, and counting it would show somebody as over a limit they have not
   * actually reached.
   */
  private async spentInPeriod(
    organizationId: string,
    cardId: string,
    period: string,
    currency: string,
  ): Promise<{ total: Money; count: number }> {
    const since = periodStart(period, new Date());

    const rows = await this.database.unscoped.transaction.findMany({
      where: {
        organizationId,
        cardId,
        status: 'POSTED',
        ...(since === null ? {} : { occurredAt: { gte: since } }),
      },
      select: { amount: true, currency: true },
    });

    // Summed with `Money`, never with `+`. Adding decimal strings as numbers is
    // how a total ends up a hundredth out and nobody can say which row did it.
    // Rows in another currency are excluded rather than converted, because
    // converting at an unrecorded rate is a number that cannot be checked.
    const matching = rows.filter((row) => row.currency === currency);

    return {
      total: Money.sum(
        matching.map((row) => Money.of(row.amount, row.currency)),
        currency,
      ),
      count: rows.length,
    };
  }

  private async assertEntityIsOurs(
    tx: Prisma.TransactionClient,
    organizationId: string,
    entityId: string,
  ): Promise<void> {
    const entity = await tx.entity.findFirst({
      where: { id: entityId, organizationId },
      select: { status: true },
    });

    // A 404 rather than a 403 for one belonging to another organisation: the
    // field must not become a way to test whether an id exists elsewhere.
    if (entity === null) throw new NotFoundError('Entity');

    if (entity.status !== 'ACTIVE') {
      throw new ConflictError('That entity is archived. Choose an active one.');
    }
  }

  private async assertDepartmentIsOurs(
    tx: Prisma.TransactionClient,
    organizationId: string,
    departmentId: string | null,
  ): Promise<void> {
    if (departmentId === null) return;

    const department = await tx.department.findFirst({
      where: { id: departmentId, organizationId },
      select: { archivedAt: true },
    });

    if (department === null) throw new NotFoundError('Department');

    if (department.archivedAt !== null) {
      throw new ConflictError('That department is archived. Choose an active one.');
    }
  }
}

const CARD_SELECT = {
  id: true,
  name: true,
  cardType: true,
  status: true,
  holderMembershipId: true,
  entityId: true,
  departmentId: true,
  projectId: true,
  categoryId: true,
  limitAmount: true,
  limitCurrency: true,
  limitPeriod: true,
  provider: true,
  providerCardId: true,
  lastFour: true,
  expiryMonth: true,
  expiryYear: true,
  validUntil: true,
  statusReason: true,
  archivedAt: true,
  createdAt: true,
  version: true,
  holder: { select: { user: { select: { fullName: true } } } },
} as const;

interface CardRow {
  id: string;
  name: string;
  cardType: string;
  status: string;
  holderMembershipId: string;
  entityId: string;
  departmentId: string | null;
  projectId: string | null;
  categoryId: string | null;
  limitAmount: string;
  limitCurrency: string;
  limitPeriod: string;
  provider: string;
  providerCardId: string | null;
  lastFour: string | null;
  expiryMonth: number | null;
  expiryYear: number | null;
  validUntil: Date | null;
  statusReason: string | null;
  archivedAt: Date | null;
  createdAt: Date;
  version: number;
  holder: { user: { fullName: string } };
}

/**
 * The wire form.
 *
 * `providerCardId` is read from the row and deliberately **not** put on it. The
 * frontend has no use for the issuer's identifier, and a field that travels is
 * a field that ends up in a browser console and a support screenshot.
 */
function toRecord(row: CardRow): CardRecord {
  return {
    id: row.id,
    name: row.name,
    cardType: row.cardType as CardRecord['cardType'],
    status: row.status as CardRecord['status'],
    holder: { membershipId: row.holderMembershipId, fullName: row.holder.user.fullName },
    entityId: row.entityId,
    departmentId: row.departmentId,
    projectId: row.projectId,
    categoryId: row.categoryId,
    limit: { amount: row.limitAmount, currency: row.limitCurrency },
    limitPeriod: row.limitPeriod as CardRecord['limitPeriod'],
    provider: row.provider,
    lastFour: row.lastFour,
    expiryMonth: row.expiryMonth,
    expiryYear: row.expiryYear,
    validUntil: row.validUntil?.toISOString() ?? null,
    statusReason: row.statusReason,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    version: row.version,
  };
}

const STATUS_AUDIT_ACTIONS: Readonly<Record<'ACTIVE' | 'FROZEN' | 'TERMINATED', string>> = {
  ACTIVE: 'card.unfrozen',
  FROZEN: 'card.frozen',
  TERMINATED: 'card.terminated',
};

/**
 * When the current limit period began.
 *
 * `null` for `PER_TRANSACTION` and `TOTAL`: neither has a window, and returning
 * an arbitrary one would produce a "spent this period" figure that means
 * nothing. All boundaries are UTC, so the same card does not reset at a
 * different moment depending on where the server runs.
 */
function periodStart(period: string, now: Date): Date | null {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();

  switch (period) {
    case 'DAILY':
      return new Date(Date.UTC(year, month, now.getUTCDate()));
    case 'WEEKLY': {
      // Monday, because a spending week that starts on Sunday surprises
      // everybody outside the United States and matches no fiscal calendar.
      const day = (now.getUTCDay() + 6) % 7;
      return new Date(Date.UTC(year, month, now.getUTCDate() - day));
    }
    case 'MONTHLY':
      return new Date(Date.UTC(year, month, 1));
    case 'QUARTERLY':
      return new Date(Date.UTC(year, Math.floor(month / 3) * 3, 1));
    case 'YEARLY':
      return new Date(Date.UTC(year, 0, 1));
    default:
      return null;
  }
}

function requireOrganization(): string {
  const organizationId = getOrganizationId();

  if (organizationId === undefined) {
    throw new Error('Cards cannot be read or written without a tenant context.');
  }

  return organizationId;
}

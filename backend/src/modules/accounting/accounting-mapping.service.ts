import type {
  AccountingMappingRecord,
  CreateAccountingMapping,
  MappingResult,
  SimulateMapping,
  UpdateAccountingMapping,
} from '@financy/contracts';
import { ConflictError, NotFoundError, ValidationError, newId } from '@financy/core';
import type { Prisma } from '@financy/db';
import { Injectable } from '@nestjs/common';

import { AuditService } from '../../platform/audit/index.js';
import { guardVersion } from '../../platform/concurrency/index.js';
import { DatabaseService } from '../../platform/database/index.js';
import { getOrganizationId } from '../../platform/request-context/index.js';

/** The dimensions a record carries into the mapping. */
export interface MappingDimensions {
  readonly categoryId?: string | null | undefined;
  readonly departmentId?: string | null | undefined;
  readonly entityId?: string | null | undefined;
  readonly vendorId?: string | null | undefined;
  readonly spendType?: string | null | undefined;
}

/**
 * Mapping rules (FR-ACC-002, epic 6.1).
 *
 * ## First match wins, ordered by priority
 *
 * The same shape as the policy engine, deliberately. A set of rules that all
 * apply is a set nobody can reason about, and "which rule decided this GL
 * account?" has to be answerable from the rules rather than from the order a
 * database happened to return them in. Ties break by creation, which is stable.
 *
 * ## A null condition means "any"
 *
 * So a rule with every condition null is the catch-all — the way an
 * organisation says "everything else goes to 6000". Having one is what turns
 * an unmapped queue from a permanent backlog into an exception list.
 *
 * ## Nothing matched is an answer, and it explains itself
 *
 * `matched: false` with the dimensions that were carried in. "No rule matched"
 * sends somebody to read every rule; naming what the record actually had tells
 * them which rule to write.
 */
@Injectable()
export class AccountingMappingService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  async list(): Promise<AccountingMappingRecord[]> {
    const rows = await this.database.client.accountingMapping.findMany({
      include: { glAccount: true, costCenter: true, taxCode: true },
      orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
    });

    return rows.map((row) => toRecord(row));
  }

  async create(input: CreateAccountingMapping): Promise<AccountingMappingRecord> {
    const organizationId = requireOrganization();

    await this.assertCodesExist(organizationId, input);

    const id = newId();

    await this.database.unscoped.$transaction(async (tx) => {
      await tx.accountingMapping.create({
        data: {
          id,
          organizationId,
          name: input.name,
          priority: input.priority,
          categoryId: input.categoryId ?? null,
          departmentId: input.departmentId ?? null,
          entityId: input.entityId ?? null,
          vendorId: input.vendorId ?? null,
          spendType: input.spendType ?? null,
          glAccountId: input.glAccountId,
          costCenterId: input.costCenterId ?? null,
          taxCodeId: input.taxCodeId ?? null,
        },
      });

      await this.audit.record(tx, {
        organizationId,
        action: 'accounting_mapping.created',
        resourceType: 'accounting_mapping',
        resourceId: id,
        after: { name: input.name, priority: input.priority },
      });
    });

    return this.get(id);
  }

  async get(id: string): Promise<AccountingMappingRecord> {
    const row = await this.database.client.accountingMapping.findFirst({
      where: { id },
      include: { glAccount: true, costCenter: true, taxCode: true },
    });

    if (row === null) throw new NotFoundError('Mapping rule');

    return toRecord(row);
  }

  async update(
    id: string,
    input: UpdateAccountingMapping,
    expectedVersion: number,
  ): Promise<AccountingMappingRecord> {
    const organizationId = requireOrganization();

    const existing = await this.database.client.accountingMapping.findFirst({ where: { id } });
    if (existing === null) throw new NotFoundError('Mapping rule');

    guardVersion('Mapping rule', expectedVersion, existing.version);

    if (input.glAccountId !== undefined) {
      await this.assertCodesExist(organizationId, { glAccountId: input.glAccountId });
    }

    await this.database.unscoped.$transaction(async (tx) => {
      const updated = await tx.accountingMapping.updateMany({
        where: { id, organizationId, version: existing.version },
        data: {
          ...(input.name === undefined ? {} : { name: input.name }),
          ...(input.priority === undefined ? {} : { priority: input.priority }),
          ...(input.categoryId === undefined ? {} : { categoryId: input.categoryId }),
          ...(input.departmentId === undefined ? {} : { departmentId: input.departmentId }),
          ...(input.entityId === undefined ? {} : { entityId: input.entityId }),
          ...(input.vendorId === undefined ? {} : { vendorId: input.vendorId }),
          ...(input.spendType === undefined ? {} : { spendType: input.spendType }),
          ...(input.glAccountId === undefined ? {} : { glAccountId: input.glAccountId }),
          ...(input.costCenterId === undefined ? {} : { costCenterId: input.costCenterId }),
          ...(input.taxCodeId === undefined ? {} : { taxCodeId: input.taxCodeId }),
          ...(input.isActive === undefined ? {} : { isActive: input.isActive }),
          version: { increment: 1 },
        },
      });

      if (updated.count === 0) throw new ConflictError('The rule changed. Read it again.');

      await this.audit.record(tx, {
        organizationId,
        action: 'accounting_mapping.updated',
        resourceType: 'accounting_mapping',
        resourceId: id,
        before: { name: existing.name, priority: existing.priority },
        after: { ...input },
      });
    });

    return this.get(id);
  }

  /** The harness FR-ACC-002 asks for: what would these rules do to this record? */
  async simulate(input: SimulateMapping): Promise<MappingResult> {
    const organizationId = requireOrganization();

    return this.resolve(organizationId, input);
  }

  /**
   * Which codes a record maps to.
   *
   * Public because the export path calls it for every eligible record, and
   * because a mapping that the simulator and the export derived differently
   * would make the harness worse than useless.
   */
  async resolve(
    organizationId: string,
    dimensions: MappingDimensions,
  ): Promise<MappingResult> {
    const rules = await this.database.unscoped.accountingMapping.findMany({
      where: { organizationId, isActive: true },
      include: { glAccount: true, costCenter: true, taxCode: true },
      orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
    });

    const match = rules.find((rule) => matches(rule, dimensions));

    if (match === undefined) {
      return {
        matched: false,
        ruleId: null,
        ruleName: null,
        glAccount: null,
        costCenter: null,
        taxCode: null,
        explanation: describeUnmatched(dimensions, rules.length),
      };
    }

    return {
      matched: true,
      ruleId: match.id,
      ruleName: match.name,
      glAccount: { code: match.glAccount.code, name: match.glAccount.name },
      costCenter:
        match.costCenter === null
          ? null
          : { code: match.costCenter.code, name: match.costCenter.name },
      taxCode:
        match.taxCode === null ? null : { code: match.taxCode.code, name: match.taxCode.name },
      explanation: `Matched "${match.name}" at priority ${String(match.priority)}.`,
    };
  }

  /**
   * Every code the rule points at must exist, be ours, and be the right kind.
   *
   * A rule whose GL account is actually a cost centre produces an export that
   * balances and posts to nothing, which is the failure mode that survives
   * every check except this one.
   */
  private async assertCodesExist(
    organizationId: string,
    input: {
      glAccountId: string;
      costCenterId?: string | null | undefined;
      taxCodeId?: string | null | undefined;
    },
  ): Promise<void> {
    const wanted: { id: string; type: string; field: string }[] = [
      { id: input.glAccountId, type: 'GL_ACCOUNT', field: 'glAccountId' },
      ...(input.costCenterId == null
        ? []
        : [{ id: input.costCenterId, type: 'COST_CENTER', field: 'costCenterId' }]),
      ...(input.taxCodeId == null
        ? []
        : [{ id: input.taxCodeId, type: 'TAX_CODE', field: 'taxCodeId' }]),
    ];

    for (const { id, type, field } of wanted) {
      const found = await this.database.unscoped.accountingCode.findFirst({
        where: { id, organizationId, codeType: type as 'GL_ACCOUNT' },
        select: { id: true },
      });

      if (found === null) {
        throw new ValidationError({
          [field]: [`That is not a ${type.toLowerCase().replace('_', ' ')} in this organisation.`],
        });
      }
    }
  }
}

interface RuleRow {
  id: string;
  name: string;
  priority: number;
  categoryId: string | null;
  departmentId: string | null;
  entityId: string | null;
  vendorId: string | null;
  spendType: string | null;
  isActive: boolean;
  version: number;
  glAccount: { id: string; code: string; name: string };
  costCenter: { id: string; code: string; name: string } | null;
  taxCode: { id: string; code: string; name: string } | null;
}

/**
 * Does this rule apply?
 *
 * A null condition matches anything. Every stated condition must hold — a rule
 * is a conjunction, so "travel spend in the Berlin entity" is one rule rather
 * than two that both half-apply.
 */
function matches(rule: RuleRow, dimensions: MappingDimensions): boolean {
  const check = (condition: string | null, value: string | null | undefined): boolean =>
    condition === null || condition === value;

  return (
    check(rule.categoryId, dimensions.categoryId ?? null) &&
    check(rule.departmentId, dimensions.departmentId ?? null) &&
    check(rule.entityId, dimensions.entityId ?? null) &&
    check(rule.vendorId, dimensions.vendorId ?? null) &&
    check(rule.spendType, dimensions.spendType ?? null)
  );
}

function describeUnmatched(dimensions: MappingDimensions, ruleCount: number): string {
  const stated = [
    dimensions.categoryId == null ? null : 'a category',
    dimensions.departmentId == null ? null : 'a department',
    dimensions.entityId == null ? null : 'an entity',
    dimensions.vendorId == null ? null : 'a supplier',
    dimensions.spendType == null ? null : `spend type ${dimensions.spendType}`,
  ].filter((part): part is string => part !== null);

  if (ruleCount === 0) {
    return 'There are no mapping rules yet. Nothing can be exported until at least one exists.';
  }

  return stated.length === 0
    ? `None of the ${String(ruleCount)} rules matched a record with no dimensions on it. A catch-all rule — one with every condition left blank — would cover this.`
    : `None of the ${String(ruleCount)} rules matched a record with ${stated.join(', ')}.`;
}

function toRecord(row: RuleRow): AccountingMappingRecord {
  return {
    id: row.id,
    name: row.name,
    priority: row.priority,
    categoryId: row.categoryId,
    departmentId: row.departmentId,
    entityId: row.entityId,
    vendorId: row.vendorId,
    spendType: row.spendType,
    glAccount: row.glAccount,
    costCenter: row.costCenter,
    taxCode: row.taxCode,
    isActive: row.isActive,
    version: row.version,
  };
}

function requireOrganization(): string {
  const organizationId = getOrganizationId();
  if (organizationId === undefined) throw new Error('No organisation in context.');
  return organizationId;
}

export type { Prisma };

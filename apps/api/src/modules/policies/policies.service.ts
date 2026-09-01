import {
  policyRuleSchema,
  type CreatePolicy,
  type PolicyDetail,
  type PolicySummary,
  type PolicyVersionSummary,
  type PublishPolicy,
  type SavePolicyRules,
  type UpdatePolicy,
} from '@financy/contracts';
import {
  ConflictError,
  DuplicateNameError,
  InvalidStateTransitionError,
  NotFoundError,
  ValidationError,
  newId,
} from '@financy/core';
import type { Prisma } from '@financy/db';
import { Injectable } from '@nestjs/common';

import { AuditService } from '../../platform/audit/index.js';
import { guardVersion } from '../../platform/concurrency/index.js';
import { DatabaseService } from '../../platform/database/index.js';
import { getContext, getOrganizationId } from '../../platform/request-context/index.js';
import { PolicyRepositoryService } from './policy-repository.service.js';

/**
 * Authoring policies (task 2.1.8, docs/11 §7).
 *
 * ## Draft and published are two different objects
 *
 * A policy owns a chain of `PolicyVersion` rows. At most one of them is open —
 * `publishedAt === null` — and that one is the draft: freely editable, invisible
 * to evaluation. Publishing stamps it and points `policy.currentVersionId` at
 * it, after which it never changes again.
 *
 * That immutability is the whole reason the split exists. Every stored decision
 * names the `policyVersionIds` it was made under, so "why was this approved?"
 * has to be answerable from the version as it was — and a version that could be
 * edited afterwards would answer with today's rules while looking like history.
 *
 * ## Editing a published policy opens a new draft rather than reopening the old one
 *
 * `saveRules` on a policy whose only version is published copies that version's
 * rules into a fresh draft. The alternative — unpublishing — would take the
 * organisation's live rules out of evaluation the instant somebody opened the
 * editor, which is how an editing session becomes an outage.
 *
 * ## Rule ids are minted once and then carried
 *
 * A rule keeps its id across versions. `matchedRuleIds` on a decision made in
 * March still names a rule that exists in June, even after it was edited — and
 * a "which rule did this?" screen resolves rather than showing a dangling id.
 *
 * ## Every write invalidates the cache
 *
 * `PolicyRepositoryService` caches active versions per organisation. A publish
 * that did not invalidate would leave the previous rules deciding spend for up
 * to the TTL, which is the kind of bug that only shows up as "it took a while
 * to take effect" and is never reported.
 */
@Injectable()
export class PoliciesService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
    private readonly repository: PolicyRepositoryService,
  ) {}

  async list(): Promise<PolicySummary[]> {
    const organizationId = requireOrganization();

    const policies = await this.database.client.policy.findMany({
      orderBy: [{ priority: 'desc' }, { name: 'asc' }],
      select: POLICY_SELECT,
    });

    const versions = await this.database.unscoped.policyVersion.findMany({
      where: { organizationId, policyId: { in: policies.map((policy) => policy.id) } },
      select: { id: true, policyId: true, version: true, snapshot: true, publishedAt: true },
      orderBy: { version: 'desc' },
    });

    return policies.map((policy) => toSummary(policy, versions));
  }

  async get(id: string): Promise<PolicyDetail> {
    const organizationId = requireOrganization();

    const policy = await this.database.client.policy.findFirst({
      where: { id },
      select: POLICY_SELECT,
    });

    if (policy === null) throw new NotFoundError('Policy');

    const versions = await this.database.unscoped.policyVersion.findMany({
      where: { organizationId, policyId: id },
      select: VERSION_SELECT,
      orderBy: { version: 'desc' },
    });

    const draft = versions.find((version) => version.publishedAt === null) ?? null;
    const published = versions.find((version) => version.id === policy.currentVersionId) ?? null;

    return {
      ...toSummary(policy, versions),
      // The editable set: the draft if one is open, otherwise what is live —
      // opening the editor on a published policy should show its rules, not an
      // empty canvas that would silently replace them on the first save.
      rules: readRules(draft?.snapshot ?? published?.snapshot ?? null),
      publishedRules: readRules(published?.snapshot ?? null),
      versions: versions.map(toVersionSummary),
    };
  }

  async create(input: CreatePolicy): Promise<PolicyDetail> {
    const organizationId = requireOrganization();

    assertWindowOrder(input.effectiveFrom ?? null, input.effectiveTo ?? null);

    const id = await this.database.unscoped.$transaction(async (tx) => {
      await this.assertNameFree(tx, organizationId, input.name, null);

      const policyId = newId();

      await tx.policy.create({
        data: {
          id: policyId,
          organizationId,
          name: input.name,
          description: input.description ?? null,
          spendTypes: input.spendTypes,
          priority: input.priority,
          // Created as a draft, always. A policy that could arrive `ACTIVE`
          // with rules the author has not seen evaluated is a policy that
          // decides spend before anybody has read it.
          status: 'DRAFT',
          currentVersionId: null,
          effectiveFrom: toDate(input.effectiveFrom ?? null),
          effectiveTo: toDate(input.effectiveTo ?? null),
        },
      });

      await tx.policyVersion.create({
        data: {
          id: newId(),
          organizationId,
          policyId,
          version: 1,
          snapshot: { rules: [] },
          createdByMembershipId: getContext()?.membershipId ?? null,
          note: null,
          publishedAt: null,
        },
      });

      await this.audit.record(tx, {
        action: 'policy.created',
        resourceType: 'policy',
        resourceId: policyId,
        after: { name: input.name, spendTypes: input.spendTypes, priority: input.priority },
      });

      return policyId;
    });

    return this.get(id);
  }

  async update(id: string, input: UpdatePolicy, expectedVersion: number): Promise<PolicyDetail> {
    const organizationId = requireOrganization();

    await this.database.unscoped.$transaction(async (tx) => {
      const before = await tx.policy.findFirst({
        where: { id, organizationId },
        select: POLICY_SELECT,
      });

      if (before === null) throw new NotFoundError('Policy');

      guardVersion('Policy', expectedVersion, before.version);

      if (before.status === 'ARCHIVED') {
        throw new ConflictError('An archived policy cannot be edited. Restore it first.');
      }

      if (input.name !== undefined && input.name !== before.name) {
        await this.assertNameFree(tx, organizationId, input.name, id);
      }

      // Checked against both halves rather than only the supplied one. A PATCH
      // moving just `effectiveTo` behind an existing `effectiveFrom` passes the
      // schema and produces a policy that is never in effect and never errors.
      assertWindowOrder(
        input.effectiveFrom === undefined
          ? toIso(before.effectiveFrom)
          : (input.effectiveFrom ?? null),
        input.effectiveTo === undefined ? toIso(before.effectiveTo) : (input.effectiveTo ?? null),
      );

      const after = await tx.policy.update({
        where: { id, version: expectedVersion },
        data: {
          ...(input.name === undefined ? {} : { name: input.name }),
          ...(input.description === undefined ? {} : { description: input.description }),
          ...(input.spendTypes === undefined ? {} : { spendTypes: input.spendTypes }),
          ...(input.priority === undefined ? {} : { priority: input.priority }),
          ...(input.effectiveFrom === undefined
            ? {}
            : { effectiveFrom: toDate(input.effectiveFrom) }),
          ...(input.effectiveTo === undefined ? {} : { effectiveTo: toDate(input.effectiveTo) }),
          version: { increment: 1 },
        },
        select: POLICY_SELECT,
      });

      await this.audit.record(tx, {
        action: 'policy.updated',
        resourceType: 'policy',
        resourceId: id,
        before: {
          name: before.name,
          priority: before.priority,
          spendTypes: before.spendTypes,
        },
        after: { name: after.name, priority: after.priority, spendTypes: after.spendTypes },
      });
    });

    // Priority and spend types decide what evaluation applies, so the cache is
    // stale the moment either changes.
    this.repository.invalidate(organizationId);

    return this.get(id);
  }

  /**
   * Replace the draft's rules.
   *
   * Wholesale, because rules interact: a `terminal` rule at sequence 2 decides
   * whether sequence 3 ever runs, and two editors each saving a coherent
   * single-rule change can produce a set neither of them intended.
   */
  async saveRules(id: string, input: SavePolicyRules): Promise<PolicyDetail> {
    const organizationId = requireOrganization();

    // Ids are minted here rather than in the schema's `default`, so that a rule
    // that already had one keeps it across the edit — that id is what a stored
    // decision's `matchedRuleIds` refers to.
    const rules: StoredRule[] = input.rules.map((rule) => ({
      ...rule,
      id: rule.id ?? newId(),
    }));

    assertSequencesUnique(rules);

    await this.database.unscoped.$transaction(async (tx) => {
      const policy = await tx.policy.findFirst({
        where: { id, organizationId },
        select: POLICY_SELECT,
      });

      if (policy === null) throw new NotFoundError('Policy');

      if (policy.status === 'ARCHIVED') {
        throw new ConflictError('An archived policy cannot be edited. Restore it first.');
      }

      const draft = await tx.policyVersion.findFirst({
        where: { organizationId, policyId: id, publishedAt: null },
        select: { id: true, version: true },
        orderBy: { version: 'desc' },
      });

      if (draft === null) {
        // Everything is published, so editing opens a new draft rather than
        // reopening the live one — unpublishing would take the organisation's
        // rules out of evaluation the moment somebody opened the editor.
        const highest = await tx.policyVersion.findFirst({
          where: { organizationId, policyId: id },
          select: { version: true },
          orderBy: { version: 'desc' },
        });

        await tx.policyVersion.create({
          data: {
            id: newId(),
            organizationId,
            policyId: id,
            version: (highest?.version ?? 0) + 1,
            snapshot: { rules } as unknown as Prisma.InputJsonValue,
            createdByMembershipId: getContext()?.membershipId ?? null,
            note: null,
            publishedAt: null,
          },
        });
      } else {
        await tx.policyVersion.update({
          where: { id: draft.id },
          data: { snapshot: { rules } as unknown as Prisma.InputJsonValue },
        });
      }

      await this.audit.record(tx, {
        action: 'policy.rules_saved',
        resourceType: 'policy',
        resourceId: id,
        after: { ruleCount: rules.length, ruleIds: rules.map((rule) => rule.id) },
      });
    });

    return this.get(id);
  }

  /**
   * Freeze the draft and make it live.
   *
   * Publishing an empty rule set is refused. A policy with no rules matches
   * nothing, contributes nothing, and looks in every list exactly like one that
   * is working — the silent-failure mode this whole subsystem is designed
   * against.
   */
  async publish(id: string, input: PublishPolicy, expectedVersion: number): Promise<PolicyDetail> {
    const organizationId = requireOrganization();

    await this.database.unscoped.$transaction(async (tx) => {
      const policy = await tx.policy.findFirst({
        where: { id, organizationId },
        select: POLICY_SELECT,
      });

      if (policy === null) throw new NotFoundError('Policy');

      guardVersion('Policy', expectedVersion, policy.version);

      if (policy.status === 'ARCHIVED') {
        throw new ConflictError('An archived policy cannot be published. Restore it first.');
      }

      const draft = await tx.policyVersion.findFirst({
        where: { organizationId, policyId: id, publishedAt: null },
        select: VERSION_SELECT,
        orderBy: { version: 'desc' },
      });

      if (draft === null) {
        throw new ConflictError('There is nothing to publish — no draft is open.');
      }

      const rules = readRules(draft.snapshot);

      if (rules.length === 0) {
        throw new ValidationError({
          rules: ['A policy with no rules would match nothing. Add at least one rule.'],
        });
      }

      const now = new Date();

      await tx.policyVersion.update({
        where: { id: draft.id },
        data: { publishedAt: now, note: input.note ?? null },
      });

      await tx.policy.update({
        where: { id, version: expectedVersion },
        data: {
          currentVersionId: draft.id,
          // Publishing is what makes a policy live. Leaving it `DRAFT` with a
          // published version would be a policy that looks inactive in every
          // list and is deciding spend.
          status: 'ACTIVE',
          version: { increment: 1 },
        },
      });

      await this.audit.record(tx, {
        action: 'policy.published',
        resourceType: 'policy',
        resourceId: id,
        before: { currentVersionId: policy.currentVersionId },
        after: {
          currentVersionId: draft.id,
          version: draft.version,
          ruleCount: rules.length,
          note: input.note ?? null,
        },
      });
    });

    this.repository.invalidate(organizationId);

    return this.get(id);
  }

  /**
   * Take a policy out of evaluation, or put it back.
   *
   * Archiving rather than deleting, and the reason is the audit trail: a
   * decision made last quarter names this policy, and a deleted policy makes
   * that decision unexplainable. Nothing that has ever decided anything is
   * removable.
   */
  async setStatus(
    id: string,
    status: 'ACTIVE' | 'ARCHIVED',
    expectedVersion: number,
  ): Promise<PolicyDetail> {
    const organizationId = requireOrganization();

    await this.database.unscoped.$transaction(async (tx) => {
      const policy = await tx.policy.findFirst({
        where: { id, organizationId },
        select: POLICY_SELECT,
      });

      if (policy === null) throw new NotFoundError('Policy');

      guardVersion('Policy', expectedVersion, policy.version);

      if (policy.status === status) {
        throw new InvalidStateTransitionError('Policy', policy.status, status);
      }

      if (status === 'ACTIVE' && policy.currentVersionId === null) {
        throw new ConflictError(
          'This policy has never been published, so there is nothing to activate.',
        );
      }

      await tx.policy.update({
        where: { id, version: expectedVersion },
        data: { status, version: { increment: 1 } },
      });

      await this.audit.record(tx, {
        action: status === 'ARCHIVED' ? 'policy.archived' : 'policy.activated',
        resourceType: 'policy',
        resourceId: id,
        before: { status: policy.status },
        after: { status },
      });
    });

    this.repository.invalidate(organizationId);

    return this.get(id);
  }

  // ── internals ────────────────────────────────────────────────────────────

  private async assertNameFree(
    tx: Prisma.TransactionClient,
    organizationId: string,
    name: string,
    excludeId: string | null,
  ): Promise<void> {
    const clash = await tx.policy.findFirst({
      where: { organizationId, name, ...(excludeId === null ? {} : { id: { not: excludeId } }) },
      select: { id: true },
    });

    if (clash !== null) throw new DuplicateNameError('Policy', name);
  }
}

/**
 * A rule in its *stored* form — the schema's inferred type, not the domain's.
 *
 * `@financy/core`'s `PolicyRule` is deeply readonly, which is right for a pure
 * evaluator and wrong for a value on its way into a database write. The two
 * describe the same shape; this is the mutable end of it.
 */
type StoredRule = PolicyDetail['rules'][number];

const POLICY_SELECT = {
  id: true,
  name: true,
  description: true,
  spendTypes: true,
  priority: true,
  status: true,
  currentVersionId: true,
  effectiveFrom: true,
  effectiveTo: true,
  updatedAt: true,
  version: true,
} as const;

const VERSION_SELECT = {
  id: true,
  policyId: true,
  version: true,
  snapshot: true,
  note: true,
  publishedAt: true,
  createdAt: true,
  createdBy: { select: { user: { select: { fullName: true } } } },
} as const;

interface PolicyRow {
  id: string;
  name: string;
  description: string | null;
  spendTypes: string[];
  priority: number;
  status: 'DRAFT' | 'ACTIVE' | 'ARCHIVED';
  currentVersionId: string | null;
  effectiveFrom: Date | null;
  effectiveTo: Date | null;
  updatedAt: Date;
  version: number;
}

interface VersionRow {
  id: string;
  policyId: string;
  version: number;
  snapshot: unknown;
  publishedAt: Date | null;
}

/**
 * Read a stored snapshot back into rules, dropping anything that no longer
 * parses.
 *
 * Dropping rather than throwing, and the choice is the same one the repository
 * makes at evaluation time: one unreadable rule must not make a policy screen
 * unopenable, because an unopenable screen is also an unfixable one.
 */
function readRules(snapshot: unknown): StoredRule[] {
  if (snapshot === null || typeof snapshot !== 'object') return [];

  const raw = (snapshot as { rules?: unknown }).rules;
  if (!Array.isArray(raw)) return [];

  const rules: StoredRule[] = [];

  for (const candidate of raw) {
    const parsed = policyRuleSchema.safeParse(candidate);
    if (parsed.success) rules.push(parsed.data);
  }

  return rules;
}

function toSummary(policy: PolicyRow, versions: readonly VersionRow[]): PolicySummary {
  const mine = versions.filter((version) => version.policyId === policy.id);
  const draft = mine.find((version) => version.publishedAt === null) ?? null;
  const published = mine.find((version) => version.id === policy.currentVersionId) ?? null;

  const editable = draft ?? published;

  return {
    id: policy.id,
    name: policy.name,
    description: policy.description,
    spendTypes: policy.spendTypes as PolicySummary['spendTypes'],
    priority: policy.priority,
    status: policy.status,
    currentVersion: published?.version ?? null,
    // A draft that exists at all is a change nobody has published. Comparing
    // rule bodies would be more precise and less useful: the editor saves on
    // every change, so "identical to what is live" is a state that lasts a
    // keystroke.
    hasUnpublishedChanges: draft !== null,
    ruleCount: readRules(editable?.snapshot ?? null).length,
    effectiveFrom: toIso(policy.effectiveFrom),
    effectiveTo: toIso(policy.effectiveTo),
    updatedAt: policy.updatedAt.toISOString(),
    version: policy.version,
  };
}

function toVersionSummary(row: {
  id: string;
  version: number;
  snapshot: unknown;
  note: string | null;
  publishedAt: Date | null;
  createdAt: Date;
  createdBy: { user: { fullName: string } } | null;
}): PolicyVersionSummary {
  return {
    id: row.id,
    version: row.version,
    ruleCount: readRules(row.snapshot).length,
    publishedAt: row.publishedAt === null ? null : row.publishedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    createdBy: row.createdBy?.user.fullName ?? null,
    note: row.note,
  };
}

/**
 * Two rules at the same sequence evaluate in id order, which is stable but
 * arbitrary — and an author who wrote them expecting an order did not mean
 * "whichever id sorts first". Refused at authoring time, where it can be
 * explained.
 */
function assertSequencesUnique(rules: readonly StoredRule[]): void {
  const seen = new Set<number>();

  for (const rule of rules) {
    if (seen.has(rule.sequence)) {
      throw new ValidationError({
        rules: [`Two rules share sequence ${String(rule.sequence)}. Each needs its own position.`],
      });
    }

    seen.add(rule.sequence);
  }
}

function assertWindowOrder(from: string | null, to: string | null): void {
  if (from === null || to === null) return;
  if (new Date(to).getTime() > new Date(from).getTime()) return;

  throw new ValidationError({
    effectiveTo: ['A policy cannot stop being in effect before it starts.'],
  });
}

function toDate(value: string | null): Date | null {
  return value === null ? null : new Date(value);
}

function toIso(value: Date | null): string | null {
  return value === null ? null : value.toISOString();
}

function requireOrganization(): string {
  const organizationId = getOrganizationId();

  if (organizationId === undefined) {
    throw new Error('Policies cannot be read or written without a tenant context.');
  }

  return organizationId;
}

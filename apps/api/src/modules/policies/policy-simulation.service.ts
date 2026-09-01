import { policyRuleSchema, type SimulatePolicy, type SimulationResult } from '@financy/contracts';
import {
  NotFoundError,
  ValidationError,
  evaluate,
  type PolicyContext,
  type PolicyRule,
  type PolicyVersion,
} from '@financy/core';
import type { Prisma } from '@financy/db';
import { Injectable } from '@nestjs/common';

import { DatabaseService } from '../../platform/database/index.js';
import { getContext, getOrganizationId } from '../../platform/request-context/index.js';
import { PolicyContextService } from './policy-context.service.js';

/**
 * "What would happen, if?" (task 2.1.8, docs/11 §8).
 *
 * This endpoint exists because of what the evaluator is: a pure function of a
 * context and a set of versions. Nothing is created, nothing is audited as
 * spend, no approval chain opens — the same code that decides real spend is
 * asked a hypothetical and answers it exactly as it would answer the real one.
 *
 * **It answers against drafts, and that is the point.** Publishing a rule to
 * find out what it does is how an organisation discovers a mistake by blocking
 * its own payroll. `includeDraftOfPolicyId` swaps one policy's published rules
 * for its unpublished ones and leaves every other policy alone, so the author
 * sees their change *in the company of the rules it will actually run beside*
 * — a rule tested in isolation passes and then loses to a higher-priority
 * policy nobody remembered.
 *
 * **`at` moves the clock, not the data.** The evaluator takes `now` as input,
 * so a simulation dated to March evaluates March's fiscal period and March's
 * effective windows. It does *not* reconstruct March's policies or March's
 * spend history — that is a backtest, it needs version history per policy at a
 * date, and pretending this is one would be worse than not offering it.
 *
 * **A simulation is audited.** It reads the organisation's policies and one
 * member's department, tenure, and spend history, which is exactly the read a
 * curious manager would want and exactly the read that should leave a trace.
 */
@Injectable()
export class PolicySimulationService {
  constructor(
    private readonly database: DatabaseService,
    private readonly context: PolicyContextService,
  ) {}

  async simulate(input: SimulatePolicy): Promise<SimulationResult> {
    const organizationId = getOrganizationId();

    if (organizationId === undefined) {
      throw new Error('A simulation cannot run without a tenant context.');
    }

    const requesterMembershipId = input.requesterMembershipId ?? getContext()?.membershipId;

    if (requesterMembershipId === undefined) {
      throw new ValidationError({
        requesterMembershipId: ['Choose whose request to simulate.'],
      });
    }

    const now = input.at === undefined ? new Date() : new Date(input.at);

    return this.database.unscoped.$transaction(async (tx) => {
      await assertEntityIsOurs(tx, organizationId, input.entityId);

      const context = await this.context.build(tx, organizationId, {
        spendType: input.spendType,
        amount: input.amount.amount,
        currency: input.amount.currency,
        requesterMembershipId,
        entityId: input.entityId,
        categoryId: input.categoryId ?? null,
        projectId: input.projectId ?? null,
        memo: input.memo ?? null,
        hasReceipt: input.hasReceipt,
        neededBy:
          input.neededBy === undefined || input.neededBy === null
            ? null
            : new Date(`${input.neededBy}T00:00:00.000Z`),
        now,
      });

      const { versions, describe } = await this.assemble(
        tx,
        organizationId,
        input.includeDraftOfPolicyId ?? null,
        now,
      );

      const started = Date.now();
      const decision = evaluate(context, versions, { durationMs: 0 });

      // Re-stamped with the real elapsed time. `evaluate` takes the duration as
      // an input precisely so it stays pure — the measurement belongs out here.
      const timed = {
        ...decision,
        evaluation: { ...decision.evaluation, durationMs: Date.now() - started },
      };

      const requester = await tx.membership.findFirst({
        where: { id: requesterMembershipId, organizationId },
        select: { user: { select: { fullName: true } } },
      });

      const matchedVersionIds = new Set(timed.evaluation.policyVersionIds);

      return {
        decision: timed as SimulationResult['decision'],
        context: {
          requester: {
            membershipId: context.requester.membershipId,
            fullName: requester?.user.fullName ?? 'Unknown',
            roleKey: context.requester.roleKey,
            departmentPath: context.requester.departmentPath,
            tenureDays: context.requester.tenureDays,
          },
          amountInBaseCurrency: {
            amount: context.amountInBaseCurrency.toString(),
            currency: context.amountInBaseCurrency.currency,
          },
          fiscalPeriod: context.temporal.fiscalPeriod,
          evaluatedAt: now.toISOString(),
        },
        // Every policy that was in scope, not only the ones that matched. A
        // simulation that lists only matches cannot answer the question people
        // actually bring to it — "why did my rule not fire?"
        policiesConsidered: versions.map((version) => ({
          ...describe(version.id),
          policyId: version.policyId,
          policyVersionId: version.id,
          priority: version.priority,
          matched: matchedVersionIds.has(version.id),
        })),
      } satisfies SimulationResult;
    });
  }

  /**
   * The versions to evaluate against, and the names to show for them.
   *
   * Read directly rather than through `PolicyRepositoryService`: the cache
   * serves the real path, where a stale entry costs seconds, and a simulator
   * that answered from a cache would tell an author their just-saved draft
   * changed nothing.
   */
  private async assemble(
    tx: Prisma.TransactionClient,
    organizationId: string,
    draftPolicyId: string | null,
    now: Date,
  ): Promise<{
    versions: PolicyVersion[];
    describe: (versionId: string) => { name: string; isDraft: boolean };
  }> {
    const policies = await tx.policy.findMany({
      where: { organizationId },
      select: {
        id: true,
        name: true,
        status: true,
        priority: true,
        spendTypes: true,
        currentVersionId: true,
        effectiveFrom: true,
        effectiveTo: true,
      },
    });

    if (draftPolicyId !== null && !policies.some((policy) => policy.id === draftPolicyId)) {
      throw new NotFoundError('Policy');
    }

    const rows = await tx.policyVersion.findMany({
      where: { organizationId },
      select: { id: true, policyId: true, version: true, snapshot: true, publishedAt: true },
      orderBy: { version: 'desc' },
    });

    const versions: PolicyVersion[] = [];
    const labels = new Map<string, { name: string; isDraft: boolean }>();

    for (const policy of policies) {
      const usingDraft = policy.id === draftPolicyId;

      // The effective window is filtered here rather than in the query for the
      // reason that recurs across this codebase: on MongoDB an unwritten
      // optional field is absent, and `null` does not match absent, so the
      // obvious filter silently drops every policy without an end date.
      const inWindow =
        (policy.effectiveFrom === null || policy.effectiveFrom <= now) &&
        (policy.effectiveTo === null || policy.effectiveTo > now);

      // A draft is evaluated even when its policy is not yet active — that is
      // what "what would this do once I publish it" means. Everything else has
      // to be live to count.
      if (!usingDraft && (policy.status !== 'ACTIVE' || !inWindow)) continue;

      const row = usingDraft
        ? (rows.find(
            (candidate) => candidate.policyId === policy.id && candidate.publishedAt === null,
          ) ??
          rows.find((candidate) => candidate.id === policy.currentVersionId) ??
          null)
        : (rows.find((candidate) => candidate.id === policy.currentVersionId) ?? null);

      if (row === null) continue;

      versions.push({
        id: row.id,
        policyId: policy.id,
        version: row.version,
        spendTypes: policy.spendTypes,
        priority: policy.priority,
        rules: readRules(row.snapshot),
      });

      labels.set(row.id, { name: policy.name, isDraft: row.publishedAt === null });
    }

    return {
      versions,
      describe: (versionId) => labels.get(versionId) ?? { name: 'Unknown', isDraft: false },
    };
  }
}

function readRules(snapshot: unknown): PolicyRule[] {
  if (snapshot === null || typeof snapshot !== 'object') return [];

  const raw = (snapshot as { rules?: unknown }).rules;
  if (!Array.isArray(raw)) return [];

  const rules: PolicyRule[] = [];

  for (const candidate of raw) {
    const parsed = policyRuleSchema.safeParse(candidate);
    if (parsed.success) rules.push(parsed.data);
  }

  return rules;
}

/**
 * A 404 rather than a 403 for an entity belonging to somebody else: this field
 * must not become a way to test whether an id exists elsewhere (docs/10 §6).
 */
async function assertEntityIsOurs(
  tx: Prisma.TransactionClient,
  organizationId: string,
  entityId: string,
): Promise<void> {
  const entity = await tx.entity.findFirst({
    where: { id: entityId, organizationId },
    select: { id: true },
  });

  if (entity === null) throw new NotFoundError('Entity');
}

export type { PolicyContext };

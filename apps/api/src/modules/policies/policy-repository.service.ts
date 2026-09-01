import { policyVersionSchema } from '@financy/contracts';
import type { PolicyVersion, SpendType } from '@financy/core';
import type { Prisma } from '@financy/db';
import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';

import { DatabaseService } from '../../platform/database/index.js';

/**
 * The active policy versions for an organisation and spend type
 * (task 2.1.7, docs/11 §5).
 *
 * **Cached per organisation, invalidated on write.** Every spend evaluation
 * reads every active policy, and against a remote database that is a query per
 * request for data that changes when somebody publishes a policy — which is
 * rarely. The cache is in-process rather than shared: it holds nothing secret
 * beyond what the caller may already read, and a Redis round trip would cost
 * most of what it saves.
 *
 * The consequence of in-process caching is honest and worth stating: with more
 * than one API instance, a published policy takes effect on other instances
 * when their entry expires rather than immediately. A short TTL bounds that to
 * seconds, and the alternative — a shared cache with invalidation fan-out — is
 * a Phase 5 concern that arrives with Redis.
 *
 * **A version that fails validation is skipped, loudly.** A stored snapshot
 * that no longer parses means the schema changed under it, and evaluating a
 * half-understood rule set would be worse than evaluating without it: the
 * whole point of the closed field set is that a rule cannot mean something
 * nobody intended.
 */
@Injectable()
export class PolicyRepositoryService {
  /** Keyed by organisation. Each entry holds every active version it has. */
  private readonly cache = new Map<string, { versions: PolicyVersion[]; expiresAt: number }>();

  /**
   * Short enough that a publish is visible almost immediately on every
   * instance, long enough that a burst of requests costs one query.
   */
  private static readonly TTL_MS = 30_000;

  constructor(
    private readonly database: DatabaseService,
    private readonly logger: PinoLogger,
  ) {}

  async activeVersions(
    tx: Prisma.TransactionClient,
    organizationId: string,
    spendType: SpendType,
    now: Date,
  ): Promise<PolicyVersion[]> {
    const cached = this.cache.get(organizationId);

    const versions =
      cached !== undefined && cached.expiresAt > now.getTime()
        ? cached.versions
        : await this.load(tx, organizationId, now);

    // Filtered after the cache rather than before it: one entry per
    // organisation serves every spend type, and the filter is a predicate over
    // a handful of objects.
    return versions.filter((version) => version.spendTypes.includes(spendType));
  }

  /** Called by every write that could change what is active. */
  invalidate(organizationId: string): void {
    this.cache.delete(organizationId);
  }

  private async load(
    tx: Prisma.TransactionClient,
    organizationId: string,
    now: Date,
  ): Promise<PolicyVersion[]> {
    const policies = await tx.policy.findMany({
      where: {
        organizationId,
        status: 'ACTIVE',
        currentVersionId: { not: null },
      },
      select: {
        id: true,
        priority: true,
        spendTypes: true,
        currentVersionId: true,
        effectiveFrom: true,
        effectiveTo: true,
      },
    });

    // The effective window is filtered here rather than in the query, for the
    // reason that recurs all over this codebase: on MongoDB an optional field
    // that was never written is absent, and Prisma's `null` filter does not
    // match absent — so `effectiveTo: null` would silently exclude every
    // policy without an end date, which is most of them (ADR-0017).
    const live = policies.filter(
      (policy) =>
        (policy.effectiveFrom === null || policy.effectiveFrom <= now) &&
        (policy.effectiveTo === null || policy.effectiveTo > now),
    );

    const versionIds = live
      .map((policy) => policy.currentVersionId)
      .filter((id): id is string => id !== null);

    const rows =
      versionIds.length === 0
        ? []
        : await tx.policyVersion.findMany({
            where: { organizationId, id: { in: versionIds } },
            select: { id: true, policyId: true, version: true, snapshot: true },
          });

    const byPolicy = new Map(live.map((policy) => [policy.id, policy]));
    const versions: PolicyVersion[] = [];

    for (const row of rows) {
      const policy = byPolicy.get(row.policyId);
      if (policy === undefined) continue;

      const parsed = policyVersionSchema.safeParse({
        ...(row.snapshot as object),
        id: row.id,
        policyId: row.policyId,
        version: row.version,
        spendTypes: policy.spendTypes,
        priority: policy.priority,
      });

      if (!parsed.success) {
        // Skipped, not thrown: one unreadable policy must not stop every
        // request in the organisation. Logged at `error` because a stored
        // snapshot that no longer parses is a migration somebody owes.
        this.logger.error(
          { policyVersionId: row.id, issues: parsed.error.issues },
          'A stored policy version no longer matches the rule schema and was skipped.',
        );

        continue;
      }

      versions.push(parsed.data);
    }

    this.cache.set(organizationId, {
      versions,
      expiresAt: now.getTime() + PolicyRepositoryService.TTL_MS,
    });

    return versions;
  }
}

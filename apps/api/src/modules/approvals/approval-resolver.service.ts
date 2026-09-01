import { permissionsForRole, type RoleKey } from '@financy/contracts';
import type { ApproverSpec, PolicyContext, ResolvedStepSpec } from '@financy/core';
import { UnresolvableApproverError } from '@financy/core';
import type { Prisma } from '@financy/db';
import { Injectable } from '@nestjs/common';

/**
 * One step, with the approver specs turned into real people.
 */
export interface ResolvedStep {
  readonly sequence: number;
  readonly stepType: ResolvedStepSpec['stepType'];
  readonly quorum: number;
  readonly eligibleMembershipIds: readonly string[];
  readonly dueAt: Date | null;
}

/**
 * Turning approver specifications into people (task 2.2.2, docs/11 §6).
 *
 * A rule says "the requester's manager", never a person's id — so this runs
 * against the organisation graph at chain-resolution time, and a rule written
 * a year ago still names the right person after two reorganisations.
 *
 * **The requester is excluded before *and* after delegation (INV-02).** Both,
 * because the two catch different things: before, a rule that resolves to the
 * requester themselves — a department head approving their own department's
 * spend; after, a delegation that hands authority back to them — an approver
 * on holiday who delegated to the very person asking. The second is the one
 * that gets missed, and it is the one somebody could arrange deliberately.
 *
 * **A step that resolves to nobody is an error, not an empty step.** An
 * approval step with no eligible approver either blocks forever or, worse,
 * completes vacuously; `UnresolvableApproverError` says which rule could not
 * be satisfied so the policy can be fixed.
 */
@Injectable()
export class ApprovalResolverService {
  async resolve(
    tx: Prisma.TransactionClient,
    organizationId: string,
    context: PolicyContext,
    steps: readonly ResolvedStepSpec[],
    now: Date,
  ): Promise<ResolvedStep[]> {
    if (steps.length === 0) return [];

    const graph = await this.loadGraph(tx, organizationId, now);
    const resolved: ResolvedStep[] = [];

    for (const step of steps) {
      const candidates = new Set<string>();

      for (const spec of step.approvers) {
        for (const membershipId of this.resolveSpec(spec, context, graph)) {
          candidates.add(membershipId);
        }
      }

      // INV-02, first pass: whatever the specs resolved to, the requester is
      // not an approver of their own request.
      candidates.delete(context.requester.membershipId);

      // Delegation, then the same exclusion again — because a delegation can
      // hand the authority straight back to the requester, and that is the
      // arrangement somebody would make on purpose.
      const afterDelegation = new Set<string>();

      for (const membershipId of candidates) {
        afterDelegation.add(graph.delegatedTo.get(membershipId) ?? membershipId);
      }

      afterDelegation.delete(context.requester.membershipId);

      /**
       * Eligible means **able to act**, not merely named.
       *
       * A policy can name a role that does not hold `approval:act` — and the
       * catalogue has two such roles, because `ORG_ADMIN` administers people
       * and structure while approving spend belongs to finance and managers
       * (separation of duties, docs/03). A step resolved to people the route
       * would refuse opens a chain nobody can ever complete: the request sits
       * in the queue forever and nothing says why.
       *
       * Filtering here turns that into the failure that already exists and is
       * already legible — "no eligible approver for step 1" — raised at
       * submission, when the policy author can still be told.
       */
      const canAct = new Set(
        [...afterDelegation].filter((membershipId) => {
          const roleKey = graph.membershipRole.get(membershipId);

          return (
            roleKey !== undefined && permissionsForRole(roleKey as RoleKey).has('approval:act')
          );
        }),
      );

      if (canAct.size === 0) {
        // The step, so an administrator fixing the policy knows which one.
        // The message the caller sees is fixed by the taxonomy; the detail is
        // what makes it actionable.
        throw new UnresolvableApproverError({ details: { stepSequence: step.sequence } });
      }

      resolved.push({
        sequence: step.sequence,
        stepType: step.stepType,
        // A quorum larger than the number of eligible people can never be
        // met, so it is clamped rather than left to stall the chain.
        quorum: step.stepType === 'QUORUM' ? Math.min(2, canAct.size) : 1,
        eligibleMembershipIds: [...canAct].sort(),
        dueAt:
          step.timeoutHours === null
            ? null
            : new Date(now.getTime() + step.timeoutHours * 3_600_000),
      });
    }

    return resolved;
  }

  /**
   * Everything the specs can name, read once.
   *
   * One pass over the organisation rather than a query per spec: a chain of
   * four steps naming six approvers between them would otherwise be six
   * round trips to a remote database for data that fits in memory.
   */
  private async loadGraph(
    tx: Prisma.TransactionClient,
    organizationId: string,
    now: Date,
  ): Promise<Graph> {
    const [memberships, departments, delegations] = await Promise.all([
      tx.membership.findMany({
        where: { organizationId, status: 'ACTIVE' },
        select: {
          id: true,
          departmentId: true,
          entityScope: true,
          role: { select: { key: true } },
        },
      }),
      tx.department.findMany({
        where: { organizationId },
        select: { id: true, parentId: true, path: true, headMembershipId: true, archivedAt: true },
      }),
      tx.approvalDelegation.findMany({
        where: { organizationId, startsAt: { lte: now }, endsAt: { gt: now } },
        select: { fromMembershipId: true, toMembershipId: true, revokedAt: true },
      }),
    ]);

    return {
      byRole: memberships.reduce<Map<string, string[]>>((map, membership) => {
        const list = map.get(membership.role.key) ?? [];
        list.push(membership.id);
        map.set(membership.role.key, list);

        return map;
      }, new Map()),
      membershipDepartment: new Map(
        memberships.map((membership) => [membership.id, membership.departmentId]),
      ),
      membershipRole: new Map(memberships.map((m) => [m.id, m.role.key])),
      departments: new Map(
        departments
          .filter((department) => department.archivedAt === null)
          .map((department) => [department.id, department]),
      ),
      delegatedTo: new Map(
        delegations
          // Filtered here rather than with `revokedAt: null`, because on
          // MongoDB an unset optional field is absent and that predicate
          // would return nothing (ADR-0017) — which would silently disable
          // every delegation.
          .filter((delegation) => delegation.revokedAt === null)
          .map((delegation) => [delegation.fromMembershipId, delegation.toMembershipId]),
      ),
    };
  }

  private resolveSpec(spec: ApproverSpec, context: PolicyContext, graph: Graph): string[] {
    switch (spec.kind) {
      case 'MEMBERSHIP':
        return [spec.membershipId];

      case 'ROLE': {
        const holders = graph.byRole.get(spec.roleKey) ?? [];

        if (spec.scope === 'ORGANIZATION') return holders;

        // `DEPARTMENT` scope means holders of the role in the requester's own
        // department. `ENTITY` scope has no membership-level entity link to
        // filter on until entity scoping is enforced on approvals, so it
        // falls back to the organisation rather than resolving to nobody —
        // an over-broad step is recoverable; an unresolvable one is not.
        if (spec.scope === 'DEPARTMENT') {
          return holders.filter(
            (id) => graph.membershipDepartment.get(id) === context.requester.departmentId,
          );
        }

        return holders;
      }

      case 'DEPARTMENT_HEAD':
        return this.departmentHead(context, graph, spec.levelsUp);

      case 'MANAGER_CHAIN': {
        // `position` is 1-based: position 1 is the nearest manager.
        const membershipId = context.requester.managerChain[spec.position - 1];

        return membershipId === undefined ? [] : [membershipId];
      }

      case 'ENTITY_FINANCE_OWNER':
        // No per-entity finance owner exists yet; the organisation's finance
        // administrators are the honest stand-in, and the fallback is written
        // here rather than hidden in a default so it can be found and
        // replaced when entities gain owners (Phase 5).
        return graph.byRole.get('FINANCE_ADMIN') ?? [];

      case 'WORKFLOW':
        // Named workflows arrive with task 2.2.1's templates. Resolving to
        // nobody would produce a step that can never complete, so it raises
        // instead — the policy that names one is asking for something the
        // system cannot yet do, and should say so.
        throw new UnresolvableApproverError({
          details: {
            approverKind: 'WORKFLOW',
            reason:
              'Named approval workflows are not available yet. Use a role or the manager chain.',
          },
        });
    }
  }

  /**
   * The head of the requester's department, or of an ancestor.
   *
   * `levelsUp` walks the tree by `parentId`, so "two levels up" keeps
   * meaning the same thing after a department is inserted between them —
   * which is exactly what a rule naming a person's id would get wrong.
   *
   * A department with no head is skipped rather than failing: the useful
   * reading of "the department head" in an organisation that has not named
   * one for that team is the nearest ancestor who has.
   */
  private departmentHead(context: PolicyContext, graph: Graph, levelsUp: number): string[] {
    let current = context.requester.departmentId;

    for (let step = 0; step < levelsUp && current !== null; step += 1) {
      current = graph.departments.get(current)?.parentId ?? null;
    }

    // Then walk upwards until somebody is actually the head of something.
    for (let step = 0; step < 10 && current !== null; step += 1) {
      const department = graph.departments.get(current);
      if (department === undefined) break;

      if (department.headMembershipId !== null) return [department.headMembershipId];

      current = department.parentId;
    }

    return [];
  }
}

interface Graph {
  readonly byRole: Map<string, string[]>;
  readonly membershipDepartment: Map<string, string | null>;
  readonly membershipRole: Map<string, string>;
  readonly departments: Map<
    string,
    { id: string; parentId: string | null; path: string; headMembershipId: string | null }
  >;
  /** Who currently holds each person's delegated authority. */
  readonly delegatedTo: Map<string, string>;
}

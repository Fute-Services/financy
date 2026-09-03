import type { Prisma } from '@financy/db';
import { newId } from '@financy/core';
import { Injectable } from '@nestjs/common';

import { getContext } from '../request-context/index.js';

export type ActorType = 'USER' | 'SYSTEM' | 'PROVIDER';

export interface AuditEventInput {
  /** `membership.role_changed`, `spend_request.approved`, … */
  readonly action: string;
  readonly resourceType: string;
  readonly resourceId?: string | undefined;
  readonly before?: Prisma.InputJsonValue | undefined;
  readonly after?: Prisma.InputJsonValue | undefined;
  readonly metadata?: Prisma.InputJsonValue | undefined;
  /**
   * Overrides the actor resolved from the request context. Needed for
   * registration, where the membership being audited is created by the same
   * transaction that writes the event, so there is no context yet.
   */
  readonly actorMembershipId?: string | undefined;
  readonly actorType?: ActorType | undefined;
  readonly actorLabel?: string | undefined;
  /** Also needed at registration, before the tenant context is bound. */
  readonly organizationId?: string | undefined;
}

/**
 * Writes the audit trail.
 *
 * **Every method takes a transaction client, and that is the entire design.**
 * The audit event must commit with the change it describes or not at all — a
 * role change that succeeded without its event is an unexplained privilege in
 * production, and an event without its change is a lie in the record. Making
 * the transaction an explicit parameter means a caller cannot accidentally
 * write one outside the other's transaction; there is no overload that does.
 *
 * There is no `update` and no `delete`, here or anywhere. The database revokes
 * both privileges from the application role, so adding one would fail at
 * runtime rather than quietly working (docs/09 §1.5).
 */
@Injectable()
export class AuditService {
  /**
   * Record one event inside the caller's transaction.
   *
   * The actor, ip, user agent, and correlation id come from the request
   * context rather than from the caller, so a service cannot claim a different
   * actor than the one whose session is driving the request.
   */
  async record(tx: Prisma.TransactionClient, input: AuditEventInput): Promise<void> {
    const context = getContext();

    const organizationId = input.organizationId ?? context?.organizationId;

    if (organizationId === undefined) {
      throw new Error(
        `Cannot audit "${input.action}" with no organisation: neither the request context nor the caller supplied one.`,
      );
    }

    const actorType = input.actorType ?? (context?.membershipId === undefined ? 'SYSTEM' : 'USER');
    const actorMembershipId = input.actorMembershipId ?? context?.membershipId ?? null;

    // The database enforces this too, via the audit_actor_present CHECK. The
    // check here exists so the error names the action rather than surfacing as
    // a constraint violation three layers down.
    if (actorType === 'USER' && actorMembershipId === null) {
      throw new Error(
        `Cannot audit "${input.action}" as a USER action with no membership. Pass actorType: 'SYSTEM' with an actorLabel for a job.`,
      );
    }

    await tx.auditEvent.create({
      data: {
        id: newId(),
        organizationId,
        actorMembershipId,
        actorType,
        actorLabel: input.actorLabel ?? null,
        action: input.action,
        resourceType: input.resourceType,
        resourceId: input.resourceId ?? null,
        ...(input.before === undefined ? {} : { before: input.before }),
        ...(input.after === undefined ? {} : { after: input.after }),
        ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
        ipAddress: context?.ipAddress ?? null,
        userAgent: context?.userAgent ?? null,
        correlationId: context?.correlationId ?? 'system',
      },
    });
  }
}

import type { Prisma } from '@financy/db';
import { newId } from '@financy/core';
import { Injectable } from '@nestjs/common';

import { getContext } from '../request-context/index.js';

export type SecurityEventType =
  | 'LOGIN_SUCCEEDED'
  | 'LOGIN_FAILED'
  | 'ACCOUNT_LOCKED'
  | 'PASSWORD_CHANGED'
  | 'PASSWORD_RESET_REQUESTED'
  | 'PASSWORD_RESET_COMPLETED'
  | 'MFA_ENROLLED'
  | 'MFA_CHALLENGE_FAILED'
  | 'SESSION_REVOKED'
  | 'ROLE_CHANGED'
  | 'MEMBERSHIP_DEACTIVATED'
  | 'TENANT_MISMATCH_ATTEMPTED'
  | 'STEP_UP_FAILED';

export interface SecurityEventInput {
  readonly type: SecurityEventType;
  readonly organizationId: string;
  readonly userId?: string | undefined;
  readonly membershipId?: string | undefined;
  readonly metadata?: Prisma.InputJsonValue | undefined;
}

/**
 * Records who *tried*, as opposed to what changed.
 *
 * Separate from the audit trail because the questions differ: a failed login
 * has no resource and no before/after, and forcing it into the audit shape
 * would make both harder to query. The audit log answers "who changed this
 * record"; this answers "is someone attacking us" (docs/12 §7).
 *
 * Immutable for the same reason and by the same mechanism — the database role
 * has no `UPDATE` or `DELETE` grant on the table.
 */
@Injectable()
export class SecurityEventService {
  async record(tx: Prisma.TransactionClient, input: SecurityEventInput): Promise<void> {
    const context = getContext();

    await tx.securityEvent.create({
      data: {
        id: newId(),
        organizationId: input.organizationId,
        type: input.type,
        userId: input.userId ?? null,
        membershipId: input.membershipId ?? null,
        ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
        ipAddress: context?.ipAddress ?? null,
        userAgent: context?.userAgent ?? null,
        correlationId: context?.correlationId ?? 'system',
      },
    });
  }
}

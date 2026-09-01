import type { Prisma } from '@financy/db';
import { Injectable } from '@nestjs/common';

export type SettlementOutcome = 'APPROVED' | 'REJECTED' | 'RETURNED' | 'OVERRIDDEN';

/**
 * What a settled chain does to the thing it was about.
 *
 * Implemented by each module that owns a subject — spend requests, expenses,
 * and from Phase 5 bills and purchase orders. The chain knows a subject type
 * and an id and deliberately nothing else: an approval means "somebody agreed"
 * and what that *does* is entirely the subject's business.
 */
export interface ApprovalSubjectHandler {
  onApprovalSettled(
    tx: Prisma.TransactionClient,
    organizationId: string,
    subjectId: string,
    outcome: SettlementOutcome,
  ): Promise<void>;
}

/**
 * Which module owns which subject type.
 *
 * ## Why this exists now and not before
 *
 * With one subject type, the approval controller called the spend module
 * directly and a comment said what would happen when a second arrived. This is
 * that second: an expense is approved by the same machinery and settles into a
 * completely different record.
 *
 * The alternative — a `switch` in the controller — grows a branch and an import
 * per subject, which makes the approvals module depend on every module that
 * has ever had something approved. Registration inverts it: each owner
 * declares itself, and the chain keeps knowing nothing about any of them.
 *
 * ## An unregistered subject settles nothing, loudly
 *
 * A chain whose subject nobody owns is a request stuck in `PENDING_APPROVAL`
 * with an approved instance beside it — the exact stuck state the whole module
 * is built to avoid. Registering twice is refused for the same reason it is in
 * the job registry: one of the two would silently never run, and which one
 * would depend on module initialisation order.
 */
@Injectable()
export class ApprovalSubjectRegistry {
  private readonly handlers = new Map<string, ApprovalSubjectHandler>();

  register(subjectType: string, handler: ApprovalSubjectHandler): void {
    if (this.handlers.has(subjectType)) {
      throw new Error(
        `A handler for approval subject "${subjectType}" is already registered. Two owners for one subject means one of them never runs.`,
      );
    }

    this.handlers.set(subjectType, handler);
  }

  resolve(subjectType: string): ApprovalSubjectHandler | undefined {
    return this.handlers.get(subjectType);
  }

  get registered(): string[] {
    return [...this.handlers.keys()];
  }
}

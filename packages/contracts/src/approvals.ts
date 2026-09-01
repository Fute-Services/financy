/**
 * Approvals — the queue, acting on a step, the timeline, and delegation
 * (docs/10 §5.6, tasks 2.2.5 and 2.2.8).
 *
 * ## The comment is required for three of the five actions, and not for two
 *
 * Approving is agreeing with what was asked; there is nothing extra to say, and
 * demanding a sentence for it trains people to type "ok". A **rejection**, a
 * **return**, and an **override** all leave somebody with work to do — fix it,
 * resubmit it, or explain it to an auditor — and a decision they cannot act on
 * is a decision that has to be chased in a chat message the record never sees.
 *
 * ## An override is not an approval
 *
 * Finance settling a stalled chain and an approver approving it produce
 * different records, deliberately. The override names who forced it and why;
 * collapsing the two would make "this was approved" cover a case where nobody
 * with the authority to approve it ever did.
 */

import { z } from 'zod';

import { idSchema, timestampSchema } from './primitives.js';

export const APPROVAL_ACTIONS = ['APPROVE', 'REJECT', 'RETURN', 'DELEGATE', 'OVERRIDE'] as const;
export type ApprovalActionType = (typeof APPROVAL_ACTIONS)[number];

export const APPROVAL_ACTION_LABELS: Readonly<Record<ApprovalActionType, string>> = {
  APPROVE: 'Approved',
  REJECT: 'Rejected',
  RETURN: 'Returned for changes',
  DELEGATE: 'Delegated',
  OVERRIDE: 'Overridden by finance',
};

export const APPROVAL_INSTANCE_STATUSES = [
  'PENDING',
  'APPROVED',
  'REJECTED',
  'RETURNED',
  'CANCELLED',
  'OVERRIDDEN',
  'EXPIRED',
] as const;

export type ApprovalInstanceStatus = (typeof APPROVAL_INSTANCE_STATUSES)[number];

export const APPROVAL_INSTANCE_STATUS_LABELS: Readonly<Record<ApprovalInstanceStatus, string>> = {
  PENDING: 'Awaiting approval',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  RETURNED: 'Returned for changes',
  CANCELLED: 'Cancelled',
  OVERRIDDEN: 'Overridden',
  EXPIRED: 'Expired',
};

export const APPROVAL_STEP_STATUSES = [
  'WAITING',
  'ACTIVE',
  'APPROVED',
  'REJECTED',
  'ESCALATED',
  'RETURNED',
  'SKIPPED',
  'EXPIRED',
] as const;

export type ApprovalStepStatus = (typeof APPROVAL_STEP_STATUSES)[number];

export const APPROVAL_STEP_STATUS_LABELS: Readonly<Record<ApprovalStepStatus, string>> = {
  WAITING: 'Waiting',
  ACTIVE: 'With approvers now',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  ESCALATED: 'Escalated',
  RETURNED: 'Returned',
  SKIPPED: 'Not needed',
  EXPIRED: 'Expired',
};

/**
 * `POST /v1/approvals/{instanceId}/act`.
 *
 * The comment requirement is enforced here rather than only in the service, so
 * the refusal names the field and the form can put the message under the box —
 * a bare 409 for a missing reason is a dead end.
 */
export const actOnApprovalSchema = z
  .strictObject({
    action: z.enum(APPROVAL_ACTIONS).exclude(['DELEGATE']),
    comment: z.string().trim().max(1000).nullable().optional(),
  })
  .superRefine((value, ctx) => {
    const needsReason =
      value.action === 'REJECT' || value.action === 'RETURN' || value.action === 'OVERRIDE';

    if (
      needsReason &&
      (value.comment === null || value.comment === undefined || value.comment === '')
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['comment'],
        message:
          value.action === 'RETURN'
            ? 'Say what needs changing. A return with no reason is a request nobody can fix.'
            : value.action === 'OVERRIDE'
              ? 'An override needs a reason. It is the only record of why the chain was bypassed.'
              : 'Give a reason. The person who raised this has to know what to do next.',
      });
    }
  });

export const approvalActionSchema = z.object({
  id: idSchema,
  action: z.enum(APPROVAL_ACTIONS),
  comment: z.string().nullable(),
  actedBy: z.object({ membershipId: idSchema, fullName: z.string() }),
  /** Set when the actor used somebody else's delegated authority. */
  onBehalfOf: z.object({ membershipId: idSchema, fullName: z.string() }).nullable(),
  createdAt: timestampSchema,
});

export const approvalStepSchema = z.object({
  id: idSchema,
  sequence: z.int(),
  stepType: z.string(),
  quorum: z.int(),
  status: z.enum(APPROVAL_STEP_STATUSES),
  /**
   * Frozen when the chain opened. Shown by name, because "waiting on two
   * people" is not an answer anybody can act on.
   */
  approvers: z.array(z.object({ membershipId: idSchema, fullName: z.string() })),
  actions: z.array(approvalActionSchema),
  activatedAt: timestampSchema.nullable(),
  dueAt: timestampSchema.nullable(),
  completedAt: timestampSchema.nullable(),
});

export const approvalInstanceSchema = z.object({
  id: idSchema,
  subjectType: z.string(),
  subjectId: idSchema,
  status: z.enum(APPROVAL_INSTANCE_STATUSES),
  currentStepSequence: z.int(),
  steps: z.array(approvalStepSchema),
  /** Whether the caller can act on the step that is open right now. */
  canAct: z.boolean(),
  completedAt: timestampSchema.nullable(),
  createdAt: timestampSchema,
});

export const queueItemSchema = z.object({
  instanceId: idSchema,
  stepId: idSchema,
  sequence: z.int(),
  subjectType: z.string(),
  subjectId: idSchema,
  dueAt: timestampSchema.nullable(),
  activatedAt: timestampSchema.nullable(),
  /** Enough of the subject to decide without opening it. */
  subject: z
    .object({
      reference: z.string(),
      purpose: z.string(),
      amount: z.string(),
      currency: z.string(),
      requester: z.string(),
    })
    .nullable(),
});

/**
 * Delegation (FR-APR-009).
 *
 * **Time-bounded and non-chaining.** Bounded because an open-ended delegation
 * is authority nobody remembers granting; non-chaining because A→B→C means C
 * approves with A's authority through a hop nobody reviewed, and the resolver
 * follows exactly one link for that reason.
 */
export const createDelegationSchema = z
  .strictObject({
    /**
     * Whose authority is being lent. Absent means the caller's own — the
     * ordinary case, and the only one somebody without `approval:delegate_any`
     * may ask for.
     */
    fromMembershipId: idSchema.optional(),
    toMembershipId: idSchema,
    startsAt: timestampSchema,
    endsAt: timestampSchema,
    reason: z.string().trim().max(500).nullable().optional(),
  })
  .refine((value) => new Date(value.endsAt).getTime() > new Date(value.startsAt).getTime(), {
    path: ['endsAt'],
    message: 'A delegation cannot end before it begins.',
  });

export const delegationSchema = z.object({
  id: idSchema,
  from: z.object({ membershipId: idSchema, fullName: z.string() }),
  to: z.object({ membershipId: idSchema, fullName: z.string() }),
  startsAt: timestampSchema,
  endsAt: timestampSchema,
  reason: z.string().nullable(),
  revokedAt: timestampSchema.nullable(),
  /** True when it is in force right now — the only thing most readers want. */
  active: z.boolean(),
  createdAt: timestampSchema,
  version: z.int().min(1),
});

export const listDelegationsQuerySchema = z.object({
  /** `mine` is the default: everybody may see their own, few may see all. */
  scope: z.enum(['mine', 'all']).catch('mine').default('mine'),
  includeExpired: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .transform((value) => value === true || value === 'true')
    .optional(),
});

export type ActOnApproval = z.infer<typeof actOnApprovalSchema>;
export type ApprovalAction = z.infer<typeof approvalActionSchema>;
export type ApprovalStep = z.infer<typeof approvalStepSchema>;
export type ApprovalInstance = z.infer<typeof approvalInstanceSchema>;
export type QueueItem = z.infer<typeof queueItemSchema>;
export type CreateDelegation = z.infer<typeof createDelegationSchema>;
export type Delegation = z.infer<typeof delegationSchema>;
export type ListDelegationsQuery = z.infer<typeof listDelegationsQuerySchema>;

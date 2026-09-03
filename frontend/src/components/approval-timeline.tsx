import {
  APPROVAL_ACTION_LABELS,
  APPROVAL_STEP_STATUS_LABELS,
  STEP_TYPE_LABELS,
  type ApprovalInstance,
} from '@financy/contracts';
import { Badge } from '@financy/ui';

/**
 * A chain, step by step, with everything anybody did to it.
 *
 * Shared rather than written per subject: an expense and a bill traverse the
 * identical machinery from Phase 3, and a second copy of this would be a second
 * copy that renders `RETURNED` as "rejected" in one place and not the other.
 *
 * **Approvers are named.** "Waiting on two people" is not something a requester
 * can act on; "waiting on Priya Raman or Tom Okafor" is — they can go and ask.
 * The names come from ids frozen when the chain opened, so this shows who it
 * was actually assigned to rather than who would be assigned today.
 *
 * **A step nobody reached is still drawn.** A chain that showed only completed
 * steps would answer "what happened" and not "what is still to come", and the
 * second is what somebody waiting actually wants.
 */
export function ApprovalTimeline({ instance }: { instance: ApprovalInstance }): React.JSX.Element {
  return (
    <ol className="divide-y divide-[var(--border-subtle)]">
      {instance.steps.map((step) => {
        const open = step.status === 'ACTIVE' || step.status === 'ESCALATED';

        return (
          <li key={step.id} className="flex gap-3 px-5 py-3.5">
            <div className="flex flex-col items-center pt-0.5">
              <span
                className={
                  open
                    ? 'flex size-6 items-center justify-center rounded-full border-2 border-cobalt-500 text-[11px] font-semibold text-cobalt-600'
                    : step.status === 'APPROVED'
                      ? 'flex size-6 items-center justify-center rounded-full bg-[var(--color-success-fill)] text-[11px] font-semibold text-[var(--color-success-text)]'
                      : step.status === 'REJECTED' || step.status === 'RETURNED'
                        ? 'flex size-6 items-center justify-center rounded-full bg-[var(--color-danger-fill)] text-[11px] font-semibold text-[var(--color-danger-text)]'
                        : 'flex size-6 items-center justify-center rounded-full bg-ink-100 text-[11px] font-semibold text-ink-400'
                }
                aria-hidden="true"
              >
                {step.sequence}
              </span>
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[13px] font-medium text-ink-800">
                  {STEP_TYPE_LABELS[step.stepType] ?? step.stepType}
                  {step.stepType === 'QUORUM' && (
                    <span className="text-ink-500"> of {step.quorum}</span>
                  )}
                </span>

                <Badge
                  tone={
                    open
                      ? 'info'
                      : step.status === 'APPROVED'
                        ? 'success'
                        : step.status === 'REJECTED' || step.status === 'RETURNED'
                          ? 'danger'
                          : 'neutral'
                  }
                  dot={open}
                >
                  {APPROVAL_STEP_STATUS_LABELS[step.status] ?? step.status}
                </Badge>

                {step.dueAt !== null && open && (
                  <span className="text-[12px] text-ink-500">
                    due <time dateTime={step.dueAt}>{formatDateTime(step.dueAt)}</time>
                  </span>
                )}
              </div>

              <p className="mt-1 text-[13px] text-ink-500">
                {step.approvers.length === 0
                  ? 'No approvers were resolved for this step.'
                  : step.approvers.map((approver) => approver.fullName).join(', ')}
              </p>

              {step.actions.length > 0 && (
                <ul className="mt-2 flex flex-col gap-1.5">
                  {step.actions.map((action) => (
                    <li
                      key={action.id}
                      className="rounded-[var(--radius-sm)] bg-ink-50/70 px-2.5 py-1.5"
                    >
                      <div className="flex flex-wrap items-baseline gap-x-2 text-[13px]">
                        <span className="font-medium text-ink-800">{action.actedBy.fullName}</span>
                        <span className="text-ink-600">
                          {APPROVAL_ACTION_LABELS[action.action] ?? action.action}
                        </span>
                        {action.onBehalfOf !== null && (
                          // Both parties, always. "Who approved this?" and
                          // "under whose authority?" are different questions and
                          // a delegated approval is the case where they differ.
                          <span className="text-[12px] text-ink-500">
                            using {action.onBehalfOf.fullName}&rsquo;s authority
                          </span>
                        )}
                        <time
                          dateTime={action.createdAt}
                          className="ml-auto text-[12px] text-ink-400"
                        >
                          {formatDateTime(action.createdAt)}
                        </time>
                      </div>

                      {action.comment !== null && action.comment !== '' && (
                        <p className="mt-1 whitespace-pre-wrap text-[13px] text-ink-700">
                          {action.comment}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * Rendered on the server in a fixed locale and time zone.
 *
 * `toLocaleString` with the browser's settings produces a different string on
 * the client than on the server and hydrates with a mismatch — which shows up
 * as a console warning and a visible flash of the wrong time.
 */
function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
  });
}

'use client';

import { useActionState, useEffect, useState } from 'react';
import Link from 'next/link';
import type { QueueItem } from '@financy/contracts';
import { Badge, Button, Dialog, FormMessage, Money, Textarea } from '@financy/ui';

import { IDLE } from '@/lib/form-state';
import { actOnApproval } from './actions';

type Action = 'APPROVE' | 'REJECT' | 'RETURN' | 'OVERRIDE';

/**
 * One waiting step, with the four things that can be done to it.
 *
 * ## Approve is one click; the other three ask for a sentence
 *
 * Approving is agreeing with what was asked and there is nothing to add;
 * demanding a comment for it trains people to type "ok" and devalues the field
 * everywhere it matters. A rejection, a return, and an override each leave
 * somebody with work to do — fix it, resubmit it, explain it to an auditor —
 * and a decision they cannot act on gets chased in a chat message the record
 * never sees. The API enforces the same rule; this dialog is what makes the
 * refusal unnecessary.
 *
 * ## Override is separated visually as well as by permission
 *
 * It is not a stronger approval. It settles a chain that named somebody who
 * cannot act any more, and it is recorded as an override so that "this was
 * approved" never covers a case where nobody with the authority to approve it
 * ever did.
 */
export function QueueRow({
  item,
  canAct,
  canOverride,
}: {
  item: QueueItem;
  canAct: boolean;
  canOverride: boolean;
}): React.JSX.Element {
  const [action, setAction] = useState<Action | null>(null);

  const overdue = item.dueAt !== null && new Date(item.dueAt).getTime() < Date.now();

  return (
    <li className="flex flex-wrap items-start gap-3 px-5 py-3.5">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={`/spend/${item.subjectId}`}
            className="font-mono text-[13px] text-ink-700 hover:text-cobalt-600 hover:underline"
          >
            {item.subject?.reference ?? item.subjectId}
          </Link>
          <span className="text-[12px] text-ink-400">step {item.sequence}</span>
          {overdue && <Badge tone="warning">Overdue</Badge>}
        </div>

        <p className="mt-0.5 truncate text-sm text-ink-800">
          {item.subject?.purpose ?? 'This request could not be loaded.'}
        </p>

        <p className="mt-0.5 text-[12px] text-ink-500">
          {item.subject?.requester ?? 'Unknown'}
          {item.activatedAt !== null && <> · waiting since {formatDate(item.activatedAt)}</>}
          {item.dueAt !== null && <> · due {formatDate(item.dueAt)}</>}
        </p>
      </div>

      {item.subject !== null && (
        <div className="shrink-0 text-right text-sm font-semibold text-ink-900">
          <Money amount={item.subject.amount} currency={item.subject.currency} />
        </div>
      )}

      {canAct && (
        <div className="flex w-full shrink-0 flex-wrap items-center justify-end gap-1.5 sm:w-auto">
          <Button size="sm" variant="ghost" onClick={() => setAction('RETURN')}>
            Send back
          </Button>
          <Button size="sm" variant="danger-subtle" onClick={() => setAction('REJECT')}>
            Reject
          </Button>
          <Button size="sm" variant="primary" onClick={() => setAction('APPROVE')}>
            Approve
          </Button>
          {canOverride && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setAction('OVERRIDE')}
              title="Settle this chain without being one of its approvers. Recorded as an override."
            >
              Override
            </Button>
          )}
        </div>
      )}

      <ActDialog item={item} action={action} onClose={() => setAction(null)} />
    </li>
  );
}

const COPY: Readonly<
  Record<Action, { title: string; description: string; verb: string; needsReason: boolean }>
> = {
  APPROVE: {
    title: 'Approve this request',
    description:
      'If the chain has further steps, it moves to the next one. If not, the request is approved.',
    verb: 'Approve',
    needsReason: false,
  },
  REJECT: {
    title: 'Reject this request',
    description:
      'The whole chain closes immediately and nobody else is asked. The requester cannot resubmit this one — they would raise a new request.',
    verb: 'Reject',
    needsReason: true,
  },
  RETURN: {
    title: 'Send this back for changes',
    description:
      'The requester can edit it and submit again. Resubmitting evaluates policy from scratch, so the new chain may not be this one.',
    verb: 'Send back',
    needsReason: true,
  },
  OVERRIDE: {
    title: 'Override this chain',
    description:
      'Settles it without being one of its approvers — for a chain stuck on somebody who has left, or a step nobody is eligible for. Recorded as an override, not as an approval.',
    verb: 'Override',
    needsReason: true,
  },
};

function ActDialog({
  item,
  action,
  onClose,
}: {
  item: QueueItem;
  action: Action | null;
  onClose: () => void;
}): React.JSX.Element | null {
  const [state, submit, pending] = useActionState(actOnApproval, IDLE);

  useEffect(() => {
    if (state.status === 'success') onClose();
  }, [state, onClose]);

  if (action === null) return null;

  const copy = COPY[action];

  return (
    <Dialog open onClose={onClose} title={copy.title} description={copy.description}>
      <form action={submit} className="flex flex-col gap-4">
        <input type="hidden" name="instanceId" value={item.instanceId} />
        <input type="hidden" name="subjectId" value={item.subjectId} />
        <input type="hidden" name="action" value={action} />

        {state.status === 'error' && state.message !== undefined && (
          <FormMessage>{state.message}</FormMessage>
        )}

        <div className="rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-ink-50/60 px-3 py-2.5 text-[13px] text-ink-700">
          <span className="font-mono text-[12px] text-ink-500">
            {item.subject?.reference ?? item.subjectId}
          </span>
          <div className="mt-0.5">{item.subject?.purpose}</div>
          {item.subject !== null && (
            <div className="mt-1 font-semibold text-ink-900">
              <Money amount={item.subject.amount} currency={item.subject.currency} />
            </div>
          )}
        </div>

        <Textarea
          name="comment"
          label={copy.needsReason ? 'Reason' : 'Comment'}
          required={copy.needsReason}
          rows={3}
          maxLength={1000}
          placeholder={
            action === 'RETURN'
              ? 'Say what needs changing — this is what they will act on.'
              : action === 'OVERRIDE'
                ? 'Why the chain is being bypassed. This is the only record of it.'
                : action === 'REJECT'
                  ? 'Why this is refused.'
                  : 'Optional.'
          }
          hint={
            copy.needsReason
              ? undefined
              : 'Not required. Approving is agreeing with what was asked.'
          }
          error={state.fields?.['comment']?.[0]}
        />

        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant={
              action === 'APPROVE' ? 'primary' : action === 'REJECT' ? 'danger' : 'secondary'
            }
            loading={pending}
          >
            {copy.verb}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

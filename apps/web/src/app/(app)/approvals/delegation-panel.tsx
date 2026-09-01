'use client';

import { useActionState, useEffect, useState } from 'react';
import type { Delegation } from '@financy/contracts';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Dialog,
  FormMessage,
  Input,
  Textarea,
} from '@financy/ui';

import { IDLE } from '@/lib/form-state';
import { createDelegation, revokeDelegation } from './actions';

/**
 * Lending your approval authority while you are away.
 *
 * **Time-bounded, and the form has no way to express otherwise.** An
 * open-ended delegation is authority nobody remembers granting, still live two
 * years after the holiday it was created for — so both dates are required and
 * the end one is what makes it stop.
 *
 * **It applies to chains that open in the window, not to the queue you can see
 * now.** Approvers are resolved when a chain opens and frozen there, so a
 * delegation created today does not move what is already waiting on you. The
 * copy says so, because the alternative is somebody delegating on their way out
 * of the office and being surprised that the queue is unchanged.
 *
 * The delegate must be somebody who can approve — the API refuses anybody else
 * by name, because a chain routed to a person the route would refuse is a
 * request stuck in a queue forever with nothing saying why.
 */
export function DelegationPanel({
  delegations,
  myMembershipId,
}: {
  delegations: readonly Delegation[];
  myMembershipId: string;
}): React.JSX.Element {
  const [creating, setCreating] = useState(false);
  const [revoking, setRevoking] = useState<Delegation | null>(null);

  const lent = delegations.filter((entry) => entry.from.membershipId === myMembershipId);
  const held = delegations.filter((entry) => entry.to.membershipId === myMembershipId);

  return (
    <Card>
      <CardHeader
        title="Delegation"
        description="Hand your approvals to somebody else for a period."
        action={
          <Button size="sm" onClick={() => setCreating(true)}>
            Delegate
          </Button>
        }
      />

      <CardBody className="flex flex-col gap-3">
        {lent.length === 0 && held.length === 0 ? (
          <p className="text-[13px] text-ink-500">
            Nothing delegated. A delegation applies to chains that open inside its window — it does
            not move approvals already waiting on you.
          </p>
        ) : (
          <>
            {lent.length > 0 && (
              <Group title="You have lent">
                {lent.map((entry) => (
                  <Row
                    key={entry.id}
                    delegation={entry}
                    who={entry.to.fullName}
                    onRevoke={() => setRevoking(entry)}
                  />
                ))}
              </Group>
            )}

            {held.length > 0 && (
              <Group title="Lent to you">
                {held.map((entry) => (
                  <Row key={entry.id} delegation={entry} who={entry.from.fullName} />
                ))}
              </Group>
            )}
          </>
        )}
      </CardBody>

      <CreateDialog open={creating} onClose={() => setCreating(false)} />
      <RevokeDialog delegation={revoking} onClose={() => setRevoking(null)} />
    </Card>
  );
}

function Group({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div>
      <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-400">
        {title}
      </div>
      <ul className="flex flex-col gap-1.5">{children}</ul>
    </div>
  );
}

function Row({
  delegation,
  who,
  onRevoke,
}: {
  delegation: Delegation;
  who: string;
  onRevoke?: () => void;
}): React.JSX.Element {
  return (
    <li className="flex items-start gap-2 rounded-[var(--radius-sm)] bg-ink-50/60 px-2.5 py-2">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="truncate text-[13px] font-medium text-ink-800">{who}</span>
          {delegation.revokedAt !== null ? (
            <Badge tone="neutral">Revoked</Badge>
          ) : delegation.active ? (
            <Badge tone="success" dot>
              In force
            </Badge>
          ) : (
            // "Scheduled" and "expired" both render as not-in-force, and a
            // reader comparing two dates to tell them apart is a reader who
            // misreads one of them.
            <Badge tone="neutral">
              {new Date(delegation.startsAt).getTime() > Date.now() ? 'Scheduled' : 'Expired'}
            </Badge>
          )}
        </div>
        <p className="mt-0.5 text-[12px] text-ink-500">
          {formatDate(delegation.startsAt)} → {formatDate(delegation.endsAt)}
        </p>
        {delegation.reason !== null && delegation.reason !== '' && (
          <p className="mt-0.5 text-[12px] text-ink-600">{delegation.reason}</p>
        )}
      </div>

      {onRevoke !== undefined && delegation.revokedAt === null && (
        <Button size="sm" variant="ghost" onClick={onRevoke} aria-label="Revoke this delegation">
          Revoke
        </Button>
      )}
    </li>
  );
}

function CreateDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}): React.JSX.Element {
  const [state, action, pending] = useActionState(createDelegation, IDLE);

  useEffect(() => {
    if (state.status === 'success') onClose();
  }, [state, onClose]);

  const today = new Date().toISOString().slice(0, 10);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Delegate your approvals"
      description="Chains that open inside this window go to them instead. Approvals already waiting on you do not move."
    >
      <form action={action} className="flex flex-col gap-4">
        {state.status === 'error' && state.message !== undefined && (
          <FormMessage>{state.message}</FormMessage>
        )}

        <Input
          name="toMembershipId"
          label="Membership id of the person taking it on"
          required
          hint="They must hold a role that can approve spend, or the chain would never complete."
          className="font-mono text-[13px]"
          error={state.fields?.['toMembershipId']?.[0]}
        />

        <div className="grid grid-cols-2 gap-3">
          <Input
            name="startsAt"
            label="From"
            type="date"
            required
            defaultValue={today}
            error={state.fields?.['startsAt']?.[0]}
          />
          <Input
            name="endsAt"
            label="Until"
            type="date"
            required
            error={state.fields?.['endsAt']?.[0]}
          />
        </div>

        <Textarea
          name="reason"
          label="Why"
          rows={2}
          maxLength={500}
          placeholder="Annual leave."
          error={state.fields?.['reason']?.[0]}
        />

        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={pending}>
            Delegate
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function RevokeDialog({
  delegation,
  onClose,
}: {
  delegation: Delegation | null;
  onClose: () => void;
}): React.JSX.Element | null {
  const [state, action, pending] = useActionState(revokeDelegation, IDLE);

  useEffect(() => {
    if (state.status === 'success') onClose();
  }, [state, onClose]);

  if (delegation === null) return null;

  return (
    <Dialog
      open
      onClose={onClose}
      width="sm"
      title="Take back this delegation"
      description="It stops applying to chains that open from now on. Chains it already routed keep their approvers, and the record of it stays."
    >
      <form action={action} className="flex flex-col gap-4">
        <input type="hidden" name="id" value={delegation.id} />
        <input type="hidden" name="version" value={delegation.version} />

        {state.status === 'error' && state.message !== undefined && (
          <FormMessage>{state.message}</FormMessage>
        )}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Keep it
          </Button>
          <Button type="submit" variant="danger" loading={pending}>
            Revoke
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

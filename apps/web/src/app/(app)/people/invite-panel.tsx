'use client';

import { useActionState, useCallback, useState } from 'react';
import {
  ROLE_DESCRIPTIONS,
  ROLE_KEYS,
  ROLE_LABELS,
  permissionsForRole,
  type DepartmentRecord,
  type Invitation,
  type RoleKey,
} from '@financy/contracts';
import { Badge, Button, Dialog, FormMessage, Input, Select } from '@financy/ui';

import { IDLE } from '@/lib/form-state';
import { inviteMember, resendInvitation, revokeInvitation } from './actions';

/**
 * Inviting people, and the invitations already out.
 *
 * **The invite dialog previews what the role grants.** Choosing a role is
 * choosing what somebody may do to the organisation's money, and a select
 * showing five names tells the person nothing about the difference. The
 * permission list is resolved from the same catalogue the server enforces, so
 * the preview cannot promise access the guard will refuse.
 *
 * **Pending invitations are shown, not hidden.** "Did I already invite them?"
 * is the most common question this screen answers, and an invitation that
 * exists but is invisible gets sent twice and then revoked by whoever notices.
 */
export function InvitePanel({
  invitations,
  departments,
  canInvite,
}: {
  invitations: readonly Invitation[];
  departments: readonly DepartmentRecord[];
  canInvite: boolean;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);

  const close = useCallback(() => {
    setOpen(false);
  }, []);

  const pending = invitations.filter((invitation) => invitation.status === 'PENDING');

  return (
    <div className="flex flex-col gap-3">
      {canInvite ? (
        <div className="flex items-center justify-between gap-4">
          <p className="text-[13px] text-ink-600">
            {pending.length === 0
              ? 'No invitations outstanding.'
              : `${String(pending.length)} invitation${pending.length === 1 ? '' : 's'} waiting to be accepted.`}
          </p>
          <Button
            size="sm"
            variant="primary"
            onClick={() => {
              setOpen(true);
            }}
          >
            Invite someone
          </Button>
        </div>
      ) : null}

      {pending.length > 0 ? (
        <ul className="divide-y divide-[var(--border-subtle)] rounded-md border border-[var(--border-subtle)]">
          {pending.map((invitation) => (
            <li
              key={invitation.id}
              className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-[13px]"
            >
              <div className="min-w-0">
                <span className="font-medium text-ink-800">{invitation.email}</span>
                <span className="ml-2 text-ink-500">
                  {ROLE_LABELS[invitation.roleKey]} · expires{' '}
                  {new Date(invitation.expiresAt).toLocaleDateString('en-GB', {
                    day: 'numeric',
                    month: 'short',
                  })}
                </span>
                {invitation.resentCount > 0 ? (
                  <Badge tone="neutral" className="ml-2">
                    resent {invitation.resentCount}×
                  </Badge>
                ) : null}
              </div>

              {canInvite ? (
                <div className="flex gap-1">
                  <InvitationButton
                    id={invitation.id}
                    action="resend"
                    label="Resend"
                    variant="ghost"
                  />
                  <InvitationButton
                    id={invitation.id}
                    action="revoke"
                    label="Revoke"
                    variant="danger-subtle"
                  />
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {/* Mounted only while open, so each opening starts idle. */}
      {open ? <InviteDialog departments={departments} onClose={close} /> : null}
    </div>
  );
}

function InvitationButton({
  id,
  action,
  label,
  variant,
}: {
  id: string;
  action: 'resend' | 'revoke';
  label: string;
  variant: 'ghost' | 'danger-subtle';
}): React.JSX.Element {
  const [state, formAction, pending] = useActionState(
    action === 'resend' ? resendInvitation : revokeInvitation,
    IDLE,
  );

  return (
    <form action={formAction} className="inline">
      <input type="hidden" name="id" value={id} />

      <Button type="submit" size="sm" variant={variant} loading={pending}>
        {label}
      </Button>

      {state.status === 'error' && state.message !== undefined ? (
        <span className="ml-2 text-[var(--color-danger-text)]">{state.message}</span>
      ) : null}
    </form>
  );
}

function InviteDialog({
  departments,
  onClose,
}: {
  departments: readonly DepartmentRecord[];
  onClose: () => void;
}): React.JSX.Element {
  const [state, action, pending] = useActionState(inviteMember, IDLE);
  const [role, setRole] = useState<RoleKey>('EMPLOYEE');

  const field = (name: string): string | undefined => state.fields?.[name]?.[0];

  // Deliberately **not** closed on success, unlike every other dialog here.
  // The acceptance token exists in this one response and is stored as a hash;
  // if the inviter does not copy the link now they cannot get it back and
  // must issue a new invitation. Closing on their behalf would throw it away.
  const issued = state.status === 'success' && state.link !== undefined;

  // Resolved from the shared catalogue — the same one the server's guard
  // reads — so the preview cannot promise access the endpoint would refuse.
  const granted = [...permissionsForRole(role)].sort();

  return (
    <Dialog
      open
      onClose={onClose}
      title="Invite someone"
      description="They arrive with the role you choose here, so it is worth choosing deliberately."
      width="lg"
      footer={
        issued ? (
          <Button onClick={onClose} variant="primary">
            Done
          </Button>
        ) : (
          <>
            <Button onClick={onClose}>Cancel</Button>
            <Button type="submit" form="invite-form" variant="primary" loading={pending}>
              Send invitation
            </Button>
          </>
        )
      }
    >
      {issued ? <IssuedLink link={state.link ?? ''} message={state.message} /> : null}

      <form id="invite-form" action={action} className="flex flex-col gap-4" hidden={issued}>
        {state.status === 'error' && state.message !== undefined ? (
          <FormMessage>{state.message}</FormMessage>
        ) : null}

        <Input
          name="email"
          label="Email"
          type="email"
          required
          autoComplete="off"
          error={field('email')}
        />

        <Select
          name="roleKey"
          label="Role"
          value={role}
          onChange={(event) => {
            setRole(event.target.value as RoleKey);
          }}
          required
          error={field('roleKey')}
          options={ROLE_KEYS.map((key: RoleKey) => ({ value: key, label: ROLE_LABELS[key] }))}
          hint={ROLE_DESCRIPTIONS[role]}
        />

        <Select
          name="departmentId"
          label="Department"
          error={field('departmentId')}
          options={[
            { value: '', label: 'None' },
            ...departments
              .filter((department) => department.archivedAt === null)
              .map((department) => ({
                value: department.id,
                label: `${'— '.repeat(department.depth)}${department.name}`,
              })),
          ]}
          hint="Optional. It decides which spend a manager can see and approve."
        />

        <div className="rounded-md border border-[var(--border-subtle)] bg-ink-50/50 p-3">
          <p className="mb-2 text-[12px] font-medium text-ink-700">
            {ROLE_LABELS[role]} will be able to:
          </p>
          <ul className="grid grid-cols-1 gap-x-6 gap-y-0.5 sm:grid-cols-2">
            {granted.map((permission) => (
              <li key={permission} className="text-[12px] text-ink-600">
                <code>{permission}</code>
              </li>
            ))}
          </ul>
        </div>
      </form>
    </Dialog>
  );
}

/**
 * The one-time acceptance link.
 *
 * Rendered as selectable text rather than behind a "copy" button alone: a
 * clipboard write can fail silently on an insecure origin or a locked-down
 * browser, and the person would be left believing they had copied a link they
 * cannot get back.
 */
function IssuedLink({
  link,
  message,
}: {
  link: string;
  message?: string | undefined;
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-3">
      <FormMessage tone="success">{message ?? 'Invitation created.'}</FormMessage>

      <label className="text-[13px] font-medium text-ink-700" htmlFor="invite-link">
        Send them this link
      </label>

      <input
        id="invite-link"
        readOnly
        value={link}
        onFocus={(event) => {
          event.currentTarget.select();
        }}
        className="w-full rounded-md border border-[var(--border-strong)] bg-ink-50 px-3 py-2 font-mono text-[12px] text-ink-700"
      />

      <p className="text-[13px] text-ink-500">
        It is shown once. The token is stored hashed, so it cannot be recovered afterwards — if it
        is lost, resend the invitation to issue a fresh one.
      </p>
    </div>
  );
}

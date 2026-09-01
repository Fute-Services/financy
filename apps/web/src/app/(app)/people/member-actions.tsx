'use client';

import { useActionState, useCallback, useEffect, useState } from 'react';
import {
  ROLE_DESCRIPTIONS,
  ROLE_KEYS,
  ROLE_LABELS,
  type Person,
  type RoleKey,
} from '@financy/contracts';
import { Button, Dialog, FormMessage, Input, Select, Textarea } from '@financy/ui';

import { IDLE } from '@/lib/form-state';
import { changeRole, deactivateMember, reactivateMember } from './actions';

/**
 * The per-member actions: change role, deactivate, reactivate.
 *
 * Each opens a dialog rather than acting on the click, and that is not
 * ceremony. Every one of these needs something from the person before it can
 * proceed — a reason, a password, or both — and the API requires them: a
 * role change without a reason is a `422`, and one without step-up is a
 * `403`. A button that fired straight into a refusal would be a button that
 * teaches people to ignore it.
 *
 * The member's own row is never offered these. The API refuses a self role
 * change and a self deactivation outright, so offering them would be offering
 * a refusal.
 */
export function MemberActions({
  person,
  canChangeRole,
  canDeactivate,
  isSelf,
}: {
  person: Person;
  canChangeRole: boolean;
  canDeactivate: boolean;
  isSelf: boolean;
}): React.JSX.Element | null {
  const [open, setOpen] = useState<'role' | 'deactivate' | null>(null);

  const close = useCallback(() => {
    setOpen(null);
  }, []);

  const inactive = person.status === 'INACTIVE';

  if (isSelf) {
    // Not a disabled button: a control that exists and never works is worse
    // than one that does not exist. The API refuses both of these for the
    // caller's own membership, and the reasons are good ones.
    return <span className="text-[12px] text-ink-400">You</span>;
  }

  if (!canChangeRole && !canDeactivate) return null;

  return (
    <div className="flex justify-end gap-1">
      {inactive ? (
        canDeactivate ? (
          <ReactivateButton person={person} version={person.version} />
        ) : null
      ) : (
        <>
          {canChangeRole ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setOpen('role');
              }}
            >
              Change role
            </Button>
          ) : null}

          {canDeactivate ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setOpen('deactivate');
              }}
            >
              Deactivate
            </Button>
          ) : null}
        </>
      )}

      {/* Mounted only while open, so each opening starts from the idle state
          — a dialog kept mounted holds the previous submission's result and
          its close effect never fires a second time. */}
      {open === 'role' ? (
        <RoleDialog person={person} version={person.version} onClose={close} />
      ) : null}

      {open === 'deactivate' ? (
        <DeactivateDialog person={person} version={person.version} onClose={close} />
      ) : null}
    </div>
  );
}

function RoleDialog({
  person,
  version,
  onClose,
}: {
  person: Person;
  version: number;
  onClose: () => void;
}): React.JSX.Element {
  const [state, action, pending] = useActionState(changeRole, IDLE);

  useEffect(() => {
    if (state.status === 'success') onClose();
  }, [state.status, onClose]);

  const field = (name: string): string | undefined => state.fields?.[name]?.[0];

  return (
    <Dialog
      open
      onClose={onClose}
      title={`Change ${person.fullName}'s role`}
      description="A role change takes effect immediately and is recorded in the audit log and the security log."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" form="role-form" variant="primary" loading={pending}>
            Change role
          </Button>
        </>
      }
    >
      <form id="role-form" action={action} className="flex flex-col gap-4">
        <input type="hidden" name="id" value={person.id} />
        <input type="hidden" name="version" value={version} />

        {state.status === 'error' && state.message !== undefined ? (
          <FormMessage>{state.message}</FormMessage>
        ) : null}

        <Select
          name="roleKey"
          label="New role"
          defaultValue={person.role.key}
          required
          error={field('roleKey')}
          options={ROLE_KEYS.map((key: RoleKey) => ({ value: key, label: ROLE_LABELS[key] }))}
          hint={ROLE_DESCRIPTIONS[person.role.key]}
        />

        <Textarea
          name="reason"
          label="Why"
          required
          error={field('reason')}
          maxLength={500}
          hint="Six months from now, “why does this person have finance access?” is a question the audit log should answer without asking anyone."
        />

        {/* Step-up. Asked here rather than as a separate first step: doing it
            before the role is chosen would leave a window in which the person
            is re-authenticated and has not yet decided, which is the state
            step-up exists to prevent. */}
        <Input
          name="password"
          label="Confirm your password"
          type="password"
          required
          autoComplete="current-password"
          error={field('password')}
          hint="Changing someone's role needs your password again, so a stolen session alone cannot do it."
        />
      </form>
    </Dialog>
  );
}

function DeactivateDialog({
  person,
  version,
  onClose,
}: {
  person: Person;
  version: number;
  onClose: () => void;
}): React.JSX.Element {
  const [state, action, pending] = useActionState(deactivateMember, IDLE);

  useEffect(() => {
    if (state.status === 'success') onClose();
  }, [state.status, onClose]);

  return (
    <Dialog
      open
      onClose={onClose}
      title={`Deactivate ${person.fullName}`}
      description="They will be signed out of every device immediately. Their records stay, and the membership can be reactivated."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" form="deactivate-form" variant="danger" loading={pending}>
            Deactivate
          </Button>
        </>
      }
    >
      <form id="deactivate-form" action={action} className="flex flex-col gap-4">
        <input type="hidden" name="id" value={person.id} />
        <input type="hidden" name="version" value={version} />

        {state.status === 'error' && state.message !== undefined ? (
          <FormMessage>{state.message}</FormMessage>
        ) : null}

        <Textarea
          name="reason"
          label="Why"
          required
          error={state.fields?.['reason']?.[0]}
          maxLength={500}
          hint="Recorded against the deactivation, so a reader later can tell a departure from a suspension."
        />
      </form>
    </Dialog>
  );
}

function ReactivateButton({
  person,
  version,
}: {
  person: Person;
  version: number;
}): React.JSX.Element {
  const [state, action, pending] = useActionState(reactivateMember, IDLE);

  return (
    <form action={action} className="inline">
      <input type="hidden" name="id" value={person.id} />
      <input type="hidden" name="version" value={version} />

      <Button type="submit" size="sm" variant="ghost" loading={pending}>
        Reactivate
      </Button>

      {state.status === 'error' && state.message !== undefined ? (
        <span className="ml-2 text-[13px] text-[var(--color-danger-text)]">{state.message}</span>
      ) : null}
    </form>
  );
}

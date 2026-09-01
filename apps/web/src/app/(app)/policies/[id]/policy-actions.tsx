'use client';

import { useActionState, useEffect, useState } from 'react';
import { SPEND_TYPE_LABELS, type PolicyDetail } from '@financy/contracts';
import { SPEND_TYPES } from '@financy/core';
import { Button, Dialog, FormMessage, Input, Textarea } from '@financy/ui';

import { IDLE } from '@/lib/form-state';
import { publishPolicy, setPolicyArchived, updatePolicy } from '../actions';

/**
 * The three things that can be done to a policy as a whole.
 *
 * **Publish is the primary, and it is the one that carries a warning.** Every
 * other button on this screen edits something that decides nothing; this one
 * changes what the organisation is allowed to spend, immediately, for everyone.
 * The dialog says so in those words and asks for a note, because the note is
 * the only free-text record of *why* — and it is what somebody reads six months
 * later when a decision cites this version.
 *
 * **Archive is not delete, and there is no delete.** A decision made last
 * quarter names this policy; removing it would make that decision
 * unexplainable. Archiving takes it out of evaluation and leaves the record
 * intact.
 */
export function PolicyActions({ policy }: { policy: PolicyDetail }): React.JSX.Element {
  const [dialog, setDialog] = useState<'publish' | 'settings' | 'archive' | null>(null);

  return (
    <>
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={() => setDialog('settings')}>
          Settings
        </Button>

        {policy.status === 'ARCHIVED' ? (
          <Button size="sm" onClick={() => setDialog('archive')}>
            Restore
          </Button>
        ) : (
          <>
            <Button size="sm" variant="ghost" onClick={() => setDialog('archive')}>
              Archive
            </Button>
            <Button
              size="sm"
              variant="primary"
              onClick={() => setDialog('publish')}
              disabled={!policy.hasUnpublishedChanges}
              title={
                policy.hasUnpublishedChanges
                  ? undefined
                  : 'There is no open draft — nothing has changed since the last publish.'
              }
            >
              Publish
            </Button>
          </>
        )}
      </div>

      <PublishDialog policy={policy} open={dialog === 'publish'} onClose={() => setDialog(null)} />
      <SettingsDialog
        policy={policy}
        open={dialog === 'settings'}
        onClose={() => setDialog(null)}
      />
      <ArchiveDialog policy={policy} open={dialog === 'archive'} onClose={() => setDialog(null)} />
    </>
  );
}

function PublishDialog({
  policy,
  open,
  onClose,
}: {
  policy: PolicyDetail;
  open: boolean;
  onClose: () => void;
}): React.JSX.Element {
  const [state, action, pending] = useActionState(publishPolicy, IDLE);

  useEffect(() => {
    if (state.status === 'success') onClose();
  }, [state, onClose]);

  const draft = policy.versions.find((version) => version.publishedAt === null);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Publish this policy"
      description="From the moment you publish, these rules decide spend for everyone in the organisation."
    >
      <form action={action} className="flex flex-col gap-4">
        <input type="hidden" name="id" value={policy.id} />
        <input type="hidden" name="version" value={policy.version} />

        {state.status === 'error' && state.message !== undefined && (
          <FormMessage>{state.message}</FormMessage>
        )}

        <div className="rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-ink-50/60 px-3 py-2.5 text-[13px] text-ink-600">
          {draft === undefined ? (
            <>There is no open draft to publish.</>
          ) : (
            <>
              Version {draft.version} · {draft.ruleCount} {draft.ruleCount === 1 ? 'rule' : 'rules'}
              {policy.currentVersion !== null && <> · replaces version {policy.currentVersion}</>}
            </>
          )}
        </div>

        <Textarea
          name="note"
          label="What changed, and why"
          rows={3}
          maxLength={500}
          placeholder="Raised the manager approval threshold from 1,000 to 2,500 after the Q3 review."
          hint="Read by whoever asks, later, why a decision under this version came out as it did."
          error={state.fields?.['note']?.[0]}
        />

        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={pending} disabled={draft === undefined}>
            Publish
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function SettingsDialog({
  policy,
  open,
  onClose,
}: {
  policy: PolicyDetail;
  open: boolean;
  onClose: () => void;
}): React.JSX.Element {
  const [state, action, pending] = useActionState(updatePolicy, IDLE);

  useEffect(() => {
    if (state.status === 'success') onClose();
  }, [state, onClose]);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Policy settings"
      description="Name, scope, and priority. Changing these takes effect immediately — they are not part of the draft."
    >
      <form action={action} className="flex flex-col gap-4">
        <input type="hidden" name="id" value={policy.id} />
        <input type="hidden" name="version" value={policy.version} />

        {state.status === 'error' && state.message !== undefined && (
          <FormMessage>{state.message}</FormMessage>
        )}

        <Input
          name="name"
          label="Name"
          defaultValue={policy.name}
          required
          maxLength={200}
          error={state.fields?.['name']?.[0]}
        />

        <Textarea
          name="description"
          label="What this policy is for"
          defaultValue={policy.description ?? ''}
          rows={2}
          maxLength={1000}
          error={state.fields?.['description']?.[0]}
        />

        <fieldset className="flex flex-col gap-2">
          <legend className="text-[13px] font-medium text-ink-700">Applies to</legend>
          <div className="grid grid-cols-2 gap-1.5">
            {SPEND_TYPES.map((type) => (
              <label key={type} className="flex items-center gap-2 text-[13px] text-ink-700">
                <input
                  type="checkbox"
                  name="spendTypes"
                  value={type}
                  defaultChecked={policy.spendTypes.includes(type)}
                  className="size-3.5"
                />
                {SPEND_TYPE_LABELS[type] ?? type}
              </label>
            ))}
          </div>
        </fieldset>

        <Input
          name="priority"
          label="Priority"
          type="number"
          min={0}
          max={1000}
          defaultValue={policy.priority}
          hint="Higher runs first."
          error={state.fields?.['priority']?.[0]}
        />

        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={pending}>
            Save settings
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function ArchiveDialog({
  policy,
  open,
  onClose,
}: {
  policy: PolicyDetail;
  open: boolean;
  onClose: () => void;
}): React.JSX.Element {
  const [state, action, pending] = useActionState(setPolicyArchived, IDLE);
  const archiving = policy.status !== 'ARCHIVED';

  useEffect(() => {
    if (state.status === 'success') onClose();
  }, [state, onClose]);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      width="sm"
      title={archiving ? 'Archive this policy' : 'Restore this policy'}
      description={
        archiving
          ? 'It stops deciding spend immediately. Its history stays, so past decisions remain explicable.'
          : 'It goes back into evaluation using its published version.'
      }
    >
      <form action={action} className="flex flex-col gap-4">
        <input type="hidden" name="id" value={policy.id} />
        <input type="hidden" name="version" value={policy.version} />
        <input type="hidden" name="archived" value={archiving ? 'true' : 'false'} />

        {state.status === 'error' && state.message !== undefined && (
          <FormMessage>{state.message}</FormMessage>
        )}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant={archiving ? 'danger' : 'primary'} loading={pending}>
            {archiving ? 'Archive' : 'Restore'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

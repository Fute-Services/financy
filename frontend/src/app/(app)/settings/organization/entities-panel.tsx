'use client';

import { useActionState, useCallback, useEffect, useState } from 'react';
import type { EntityRecord } from '@financy/contracts';
import { Badge, Button, Dialog, FormMessage, Input } from '@financy/ui';

import { IDLE } from '@/lib/form-state';
import { createEntity, setEntityArchived, updateEntity } from './actions';

/**
 * Legal entities, with the writes attached.
 *
 * The list is rendered by the server; this component owns only the dialogs
 * and the pending state, which is the smallest thing that has to be
 * interactive. Making the whole table a client component would ship the
 * entity list to the browser twice — once as HTML and once as props — for no
 * behaviour the server could not already provide.
 *
 * **Archived entities stay visible, greyed.** An administrator looking for
 * something they archived last month needs to see that it exists and is
 * archived, not an empty row where it used to be.
 */
export function EntitiesPanel({
  entities,
  canManage,
}: {
  entities: readonly EntityRecord[];
  canManage: boolean;
}): React.JSX.Element {
  const [editing, setEditing] = useState<EntityRecord | null>(null);
  const [creating, setCreating] = useState(false);

  const active = entities.filter((entity) => entity.status === 'ACTIVE');

  // Stable, because the dialog closes itself from an effect keyed on it — an
  // inline arrow would make that effect re-run on every parent render.
  const close = useCallback(() => {
    setCreating(false);
    setEditing(null);
  }, []);

  return (
    <div className="flex flex-col">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <caption className="sr-only">Legal entities</caption>
          <thead>
            <tr className="border-b border-[var(--border-subtle)] text-left text-[13px] text-ink-500">
              <th scope="col" className="px-4 py-2 font-medium">
                Entity
              </th>
              <th scope="col" className="px-4 py-2 font-medium">
                Country
              </th>
              <th scope="col" className="px-4 py-2 font-medium">
                Currency
              </th>
              <th scope="col" className="px-4 py-2 font-medium">
                Registration
              </th>
              <th scope="col" className="px-4 py-2 font-medium">
                Status
              </th>
              {canManage ? (
                <th scope="col" className="px-4 py-2 text-right font-medium">
                  <span className="sr-only">Actions</span>
                </th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {entities.map((entity) => (
              <tr
                key={entity.id}
                className="border-b border-[var(--border-subtle)] last:border-0"
                // Archived rows are dimmed rather than hidden, and the dimming
                // is the only signal that changes — the data still reads
                // normally, because it is still true.
                data-archived={entity.status === 'ARCHIVED' ? 'true' : undefined}
              >
                <td
                  className={`px-4 py-2.5 font-medium ${
                    entity.status === 'ARCHIVED' ? 'text-ink-400' : ''
                  }`}
                >
                  {entity.name}
                </td>
                <td className="px-4 py-2.5 text-ink-600">{entity.countryCode}</td>
                <td className="tabular px-4 py-2.5 text-ink-600">{entity.functionalCurrency}</td>
                <td className="px-4 py-2.5 text-ink-600">
                  {entity.registrationNumber ?? <span className="text-ink-400">—</span>}
                </td>
                <td className="px-4 py-2.5">
                  <Badge tone={entity.status === 'ACTIVE' ? 'success' : 'neutral'}>
                    {entity.status === 'ACTIVE' ? 'Active' : 'Archived'}
                  </Badge>
                </td>
                {canManage ? (
                  <td className="px-4 py-2.5 text-right">
                    <div className="flex justify-end gap-1">
                      {entity.status === 'ACTIVE' ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setEditing(entity);
                          }}
                        >
                          Edit
                        </Button>
                      ) : null}
                      <ArchiveButton
                        entity={entity}
                        // The last active entity cannot be archived — the API
                        // refuses it. The button is still offered: a
                        // client-side guess would be wrong the moment another
                        // administrator added one, and the refusal explains
                        // itself better than a disabled button does.
                        lastActive={active.length === 1 && entity.status === 'ACTIVE'}
                      />
                    </div>
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {canManage ? (
        <div className="border-t border-[var(--border-subtle)] px-4 py-3">
          <Button
            size="sm"
            onClick={() => {
              setCreating(true);
            }}
          >
            Add entity
          </Button>
        </div>
      ) : null}

      {/* Mounted only while open, so every opening starts from IDLE.
          Keeping it mounted kept the previous submission's state: the
          close effect keys on `state.status`, which was already
          'success' from the last save, so a second create left the
          dialog open even though the record had been written. */}
      {creating || editing !== null ? <EntityDialog entity={editing} open onClose={close} /> : null}
    </div>
  );
}

function ArchiveButton({
  entity,
  lastActive,
}: {
  entity: EntityRecord;
  lastActive: boolean;
}): React.JSX.Element {
  const [state, action, pending] = useActionState(setEntityArchived, IDLE);
  const archiving = entity.status === 'ACTIVE';

  return (
    <form action={action} className="inline">
      <input type="hidden" name="id" value={entity.id} />
      <input type="hidden" name="version" value={entity.version} />
      <input type="hidden" name="archived" value={String(archiving)} />

      <Button
        type="submit"
        size="sm"
        variant={archiving ? 'danger-subtle' : 'ghost'}
        loading={pending}
        title={
          lastActive
            ? 'An organisation must keep at least one active entity.'
            : archiving
              ? 'Archive this entity'
              : 'Restore this entity'
        }
      >
        {archiving ? 'Archive' : 'Restore'}
      </Button>

      {state.status === 'error' && state.message !== undefined ? (
        <span className="ml-2 text-[13px] text-[var(--color-danger-text)]">{state.message}</span>
      ) : null}
    </form>
  );
}

function EntityDialog({
  entity,
  open,
  onClose,
}: {
  entity: EntityRecord | null;
  open: boolean;
  onClose: () => void;
}): React.JSX.Element {
  const [state, action, pending] = useActionState(
    entity === null ? createEntity : updateEntity,
    IDLE,
  );

  const field = (name: string): string | undefined => state.fields?.[name]?.[0];

  // Closed by the action succeeding, not by the click — so a refused save
  // leaves the dialog open with its message and the typed values still there.
  // In an effect rather than during render: closing is a side effect, and
  // React may render this more than once per state change.
  useEffect(() => {
    if (state.status === 'success') onClose();
  }, [state.status, onClose]);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={entity === null ? 'Add a legal entity' : 'Edit entity'}
      description={
        entity === null
          ? 'Spend is recorded against an entity, and each one has its own functional currency.'
          : undefined
      }
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" form="entity-form" variant="primary" loading={pending}>
            {entity === null ? 'Create entity' : 'Save changes'}
          </Button>
        </>
      }
    >
      <form id="entity-form" action={action} className="flex flex-col gap-4">
        {entity !== null ? (
          <>
            <input type="hidden" name="id" value={entity.id} />
            <input type="hidden" name="version" value={entity.version} />
          </>
        ) : null}

        {state.status === 'error' && state.message !== undefined ? (
          <FormMessage>{state.message}</FormMessage>
        ) : null}

        <Input
          name="name"
          label="Name"
          defaultValue={entity?.name ?? ''}
          required
          error={field('name')}
          maxLength={200}
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            name="countryCode"
            label="Country"
            defaultValue={entity?.countryCode ?? ''}
            required
            maxLength={2}
            className="uppercase"
            error={field('countryCode')}
            hint="ISO 3166, e.g. GB"
          />

          <Input
            name="functionalCurrency"
            label="Functional currency"
            defaultValue={entity?.functionalCurrency ?? ''}
            required
            maxLength={3}
            className="uppercase"
            error={field('functionalCurrency')}
            hint="ISO 4217, e.g. GBP"
          />
        </div>

        <Input
          name="registrationNumber"
          label="Registration number"
          defaultValue={entity?.registrationNumber ?? ''}
          error={field('registrationNumber')}
          maxLength={100}
          hint="Optional. Leave blank to clear it."
        />
      </form>
    </Dialog>
  );
}

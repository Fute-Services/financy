'use client';

import { useActionState, useCallback, useEffect, useState } from 'react';
import type { DepartmentRecord } from '@financy/contracts';
import { Button, Dialog, FormMessage, Input, Select } from '@financy/ui';

import { IDLE } from '@/lib/form-state';
import { createDepartment, setDepartmentArchived, updateDepartment } from './actions';

/**
 * The department tree, with the writes attached.
 *
 * Rows arrive already in `path` order — a parent always precedes its children
 * — so the tree renders by indenting in the order given, with no client-side
 * sorting and no recursion. That ordering is a property of the API, and the
 * `depth` it sends is derived from the same path, so the indent and the
 * hierarchy cannot disagree.
 *
 * **Re-parenting is a select, not a drag.** Dragging is nicer to demonstrate
 * and worse to use: it is unusable by keyboard, hard on a phone, and offers
 * no way to see the whole list of possible parents at once. The select shows
 * every legal destination, which is also the only place the cycle rule can be
 * explained before it is hit rather than after.
 */
export function DepartmentsPanel({
  departments,
  memberCounts,
  canManage,
}: {
  departments: readonly DepartmentRecord[];
  memberCounts: Record<string, number>;
  canManage: boolean;
}): React.JSX.Element {
  const [editing, setEditing] = useState<DepartmentRecord | null>(null);
  const [creating, setCreating] = useState(false);

  const close = useCallback(() => {
    setCreating(false);
    setEditing(null);
  }, []);

  const live = departments.filter((department) => department.archivedAt === null);

  return (
    <div className="flex flex-col">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <caption className="sr-only">Departments</caption>
          <thead>
            <tr className="border-b border-[var(--border-subtle)] text-left text-[13px] text-ink-500">
              <th scope="col" className="px-4 py-2 font-medium">
                Department
              </th>
              <th scope="col" className="px-4 py-2 font-medium">
                Code
              </th>
              <th scope="col" className="px-4 py-2 text-right font-medium">
                Members
              </th>
              {canManage ? (
                <th scope="col" className="px-4 py-2 text-right font-medium">
                  <span className="sr-only">Actions</span>
                </th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {departments.length === 0 ? (
              <tr>
                <td colSpan={canManage ? 4 : 3} className="px-4 py-6 text-center text-ink-500">
                  No departments yet. The approval chain and every manager-scoped view follow this
                  tree, so it is worth building before the first spend request.
                </td>
              </tr>
            ) : null}

            {departments.map((department) => {
              const archived = department.archivedAt !== null;

              return (
                <tr
                  key={department.id}
                  className="border-b border-[var(--border-subtle)] last:border-0"
                >
                  <td className="px-4 py-2.5">
                    {/* Indented by depth, which the API derives from the same
                        materialised path it sorted by — so the indent and the
                        hierarchy cannot disagree. */}
                    <span
                      style={{ paddingLeft: `${String(department.depth * 20)}px` }}
                      className={archived ? 'text-ink-400' : 'font-medium'}
                    >
                      {department.name}
                    </span>
                    {archived ? (
                      <span className="ml-2 text-[11px] text-ink-400">archived</span>
                    ) : null}
                  </td>
                  <td className="px-4 py-2.5 text-ink-600">
                    {department.code === null ? (
                      <span className="text-ink-400">—</span>
                    ) : (
                      <code className="text-[12px]">{department.code}</code>
                    )}
                  </td>
                  <td className="tabular px-4 py-2.5 text-right text-ink-600">
                    {memberCounts[department.id] ?? 0}
                  </td>
                  {canManage ? (
                    <td className="px-4 py-2.5 text-right">
                      <div className="flex justify-end gap-1">
                        {archived ? null : (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              setEditing(department);
                            }}
                          >
                            Edit
                          </Button>
                        )}
                        <ArchiveButton department={department} />
                      </div>
                    </td>
                  ) : null}
                </tr>
              );
            })}
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
            Add department
          </Button>
        </div>
      ) : null}

      {/* Mounted only while open, so every opening starts from IDLE.
          Keeping it mounted kept the previous submission's state: the
          close effect keys on `state.status`, which was already
          'success' from the last save, so a second create left the
          dialog open even though the record had been written. */}
      {creating || editing !== null ? (
        <DepartmentDialog department={editing} candidates={live} open onClose={close} />
      ) : null}
    </div>
  );
}

function ArchiveButton({ department }: { department: DepartmentRecord }): React.JSX.Element {
  const [state, action, pending] = useActionState(setDepartmentArchived, IDLE);
  const archiving = department.archivedAt === null;

  return (
    <form action={action} className="inline">
      <input type="hidden" name="id" value={department.id} />
      <input type="hidden" name="version" value={department.version} />
      <input type="hidden" name="archived" value={String(archiving)} />

      <Button
        type="submit"
        size="sm"
        variant={archiving ? 'danger-subtle' : 'ghost'}
        loading={pending}
      >
        {archiving ? 'Archive' : 'Restore'}
      </Button>

      {/* The API refuses to archive a parent with live children or active
          members, and names which. That message is more useful than a
          disabled button, and it cannot go stale. */}
      {state.status === 'error' && state.message !== undefined ? (
        <span className="ml-2 text-[13px] text-[var(--color-danger-text)]">{state.message}</span>
      ) : null}
    </form>
  );
}

function DepartmentDialog({
  department,
  candidates,
  open,
  onClose,
}: {
  department: DepartmentRecord | null;
  candidates: readonly DepartmentRecord[];
  open: boolean;
  onClose: () => void;
}): React.JSX.Element {
  const [state, action, pending] = useActionState(
    department === null ? createDepartment : updateDepartment,
    IDLE,
  );

  const field = (name: string): string | undefined => state.fields?.[name]?.[0];

  useEffect(() => {
    if (state.status === 'success') onClose();
  }, [state.status, onClose]);

  /**
   * Every department except this one and its own descendants.
   *
   * The exclusion is a `path` prefix test, the same comparison the API makes
   * — so the list offers only destinations the server would accept, and the
   * cycle rule is enforced by not being offered rather than by a 409 after
   * the fact. The server still checks: this is an affordance, not a control.
   */
  const parents = candidates.filter(
    (candidate) => department === null || !candidate.path.startsWith(department.path),
  );

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={department === null ? 'Add a department' : 'Edit department'}
      description={
        department === null
          ? 'Departments carry the approval chain, so the shape here is the shape approvals follow.'
          : undefined
      }
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" form="department-form" variant="primary" loading={pending}>
            {department === null ? 'Create department' : 'Save changes'}
          </Button>
        </>
      }
    >
      <form id="department-form" action={action} className="flex flex-col gap-4">
        {department !== null ? (
          <>
            <input type="hidden" name="id" value={department.id} />
            <input type="hidden" name="version" value={department.version} />
          </>
        ) : null}

        {state.status === 'error' && state.message !== undefined ? (
          <FormMessage>{state.message}</FormMessage>
        ) : null}

        <Input
          name="name"
          label="Name"
          defaultValue={department?.name ?? ''}
          required
          error={field('name')}
          maxLength={200}
          hint="Unique among its siblings — two departments with the same name under one parent are indistinguishable on screen."
        />

        <Select
          name="parentId"
          label="Reports into"
          defaultValue={department?.parentId ?? ''}
          error={field('parentId')}
          options={[
            { value: '', label: 'Nothing — this is a top-level department' },
            ...parents.map((candidate) => ({
              value: candidate.id,
              label: `${'— '.repeat(candidate.depth)}${candidate.name}`,
            })),
          ]}
          hint={
            department === null
              ? undefined
              : 'Moving this also moves everything under it, in one step.'
          }
        />

        <Input
          name="code"
          label="Code"
          defaultValue={department?.code ?? ''}
          error={field('code')}
          maxLength={50}
          className="uppercase"
          hint="Optional, and unique across the organisation when set. Letters, digits, and hyphens."
        />
      </form>
    </Dialog>
  );
}

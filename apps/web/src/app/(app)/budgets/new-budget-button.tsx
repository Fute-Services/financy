'use client';

import { useActionState, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  BUDGET_OVERSPEND_BEHAVIORS,
  BUDGET_OVERSPEND_BEHAVIOR_LABELS,
  BUDGET_PERIOD_GRANULARITIES,
  BUDGET_PERIOD_GRANULARITY_LABELS,
  BUDGET_SCOPE_TYPES,
  BUDGET_SCOPE_TYPE_LABELS,
  type CategoryNode,
  type DepartmentNode,
  type EntitySummary,
} from '@financy/contracts';
import { Button, Dialog, FormMessage, Input, Select } from '@financy/ui';

import { IDLE } from '@/lib/form-state';
import { createBudget } from './actions';

/**
 * Creating a budget.
 *
 * ## One dimension, and the form enforces it
 *
 * Picking "a department" then asks which department. Picking "the whole
 * organisation" asks nothing more. A form with four optional scope pickers
 * would let somebody set two and produce a budget that matches spend on one
 * dimension and not the other — a question with two defensible answers, which
 * is the same as having none.
 *
 * ## One total, spread across the periods
 *
 * Twelve boxes for twelve months serves the rare case and defeats the common
 * one. The total is split evenly here and edited per period afterwards, on the
 * budget's own page, where the numbers are next to what has been spent against
 * them.
 */
export function NewBudgetButton({
  entities,
  departments,
  categories,
  baseCurrency,
}: {
  entities: readonly EntitySummary[];
  departments: readonly DepartmentNode[];
  categories: readonly CategoryNode[];
  baseCurrency: string;
}): React.JSX.Element {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [scopeType, setScopeType] = useState<string>('DEPARTMENT');
  const [state, submit, pending] = useActionState(createBudget, IDLE);

  useEffect(() => {
    if (state.status === 'success' && state.createdId !== undefined) {
      setOpen(false);
      router.push(`/budgets/${state.createdId}`);
    }
  }, [state, router]);

  const year = new Date().getUTCFullYear();

  const scopeOptions =
    scopeType === 'DEPARTMENT'
      ? departments.map((department) => ({ value: department.id, label: department.name }))
      : scopeType === 'CATEGORY'
        ? categories.map((category) => ({ value: category.id, label: category.name }))
        : scopeType === 'ENTITY'
          ? entities.map((entity) => ({ value: entity.id, label: entity.name }))
          : [];

  return (
    <>
      <Button variant="primary" onClick={() => setOpen(true)}>
        New budget
      </Button>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Create a budget"
        description="Drawn around one thing, over one period, in one currency. Spend that matches it draws it down on its own."
      >
        <form action={submit} className="flex flex-col gap-4">
          {state.status === 'error' && state.message !== undefined && (
            <FormMessage>{state.message}</FormMessage>
          )}

          <Input name="name" label="What to call it" required maxLength={200} />

          <Select
            name="scopeType"
            label="Drawn around"
            value={scopeType}
            onChange={(event) => setScopeType(event.target.value)}
            options={BUDGET_SCOPE_TYPES.map((scope) => ({
              value: scope,
              label: BUDGET_SCOPE_TYPE_LABELS[scope],
            }))}
          />

          {scopeType !== 'ORGANIZATION' && (
            <Select
              name="scopeId"
              label="Which one"
              required
              options={scopeOptions}
              hint={
                scopeOptions.length === 0
                  ? 'There are none of these yet. Create one first, or budget the whole organisation.'
                  : undefined
              }
            />
          )}

          <Select
            name="entityId"
            label="Whose money"
            required
            options={entities.map((entity) => ({ value: entity.id, label: entity.name }))}
          />

          <div className="grid grid-cols-2 gap-3">
            <Input
              name="periodStart"
              label="From"
              type="date"
              defaultValue={`${String(year)}-01-01`}
              required
            />
            <Input
              name="periodEnd"
              label="To"
              type="date"
              defaultValue={`${String(year)}-12-31`}
              required
            />
          </div>

          <Select
            name="periodGranularity"
            label="Tracked"
            defaultValue="MONTHLY"
            options={BUDGET_PERIOD_GRANULARITIES.map((granularity) => ({
              value: granularity,
              label: BUDGET_PERIOD_GRANULARITY_LABELS[granularity],
            }))}
          />

          <div className="grid grid-cols-2 gap-3">
            <Input
              name="totalAllocated"
              label="Total to allocate"
              inputMode="decimal"
              placeholder="0.00"
              hint="Split evenly across the periods. Adjust any of them afterwards."
            />
            <Input
              name="currency"
              label="Currency"
              defaultValue={baseCurrency}
              maxLength={3}
              required
              hint="Spend in another currency does not count against this."
            />
          </div>

          <Select
            name="overspendBehavior"
            label="If spend would go over"
            defaultValue="WARN"
            options={BUDGET_OVERSPEND_BEHAVIORS.map((behavior) => ({
              value: behavior,
              label: BUDGET_OVERSPEND_BEHAVIOR_LABELS[behavior],
            }))}
          />

          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={pending}>
              Create it
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}

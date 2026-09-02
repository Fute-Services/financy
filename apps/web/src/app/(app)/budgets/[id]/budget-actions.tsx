'use client';

import { useActionState } from 'react';
import {
  BUDGET_OVERSPEND_BEHAVIORS,
  BUDGET_OVERSPEND_BEHAVIOR_LABELS,
  type BudgetDetail,
} from '@financy/contracts';
import { Button, Card, CardBody, CardHeader, FormMessage, Select } from '@financy/ui';

import { IDLE } from '@/lib/form-state';
import { updateBudget } from '../actions';

/**
 * What can be done to a budget from here.
 *
 * ## Activating is a deliberate press
 *
 * A budget starts as a draft and counts nothing. That is not a workflow for its
 * own sake: a budget created with the wrong scope would otherwise start
 * blocking spend the moment it was saved, and the person who created it would
 * find out from somebody else's failed submission.
 *
 * ## Closing is offered; reopening is not
 *
 * Reopening a closed period is a real operation with real consequences for a
 * reconciliation that has already been signed off, and it needs a reason and a
 * trail of its own. The server refuses it here rather than letting a plain
 * edit undo a close.
 */
export function BudgetActions({
  budget,
  manageable,
}: {
  budget: BudgetDetail;
  manageable: boolean;
}): React.JSX.Element | null {
  const [state, submit, pending] = useActionState(updateBudget, IDLE);

  if (!manageable) return null;

  return (
    <Card>
      <CardHeader title="Manage" />
      <CardBody className="flex flex-col gap-3">
        {state.status === 'error' && state.message !== undefined && (
          <FormMessage>{state.message}</FormMessage>
        )}
        {state.status === 'success' && state.message !== undefined && (
          <p className="text-[13px] text-[var(--color-success-text)]">{state.message}</p>
        )}

        <form action={submit} className="flex flex-col gap-3">
          <input type="hidden" name="id" value={budget.id} />
          <input type="hidden" name="version" value={String(budget.version)} />

          <Select
            name="overspendBehavior"
            label="If spend would go over"
            defaultValue={budget.overspendBehavior}
            options={BUDGET_OVERSPEND_BEHAVIORS.map((behavior) => ({
              value: behavior,
              label: BUDGET_OVERSPEND_BEHAVIOR_LABELS[behavior],
            }))}
          />

          <Button type="submit" variant="secondary" size="sm" loading={pending}>
            Save
          </Button>
        </form>

        {budget.status === 'DRAFT' && (
          <form action={submit}>
            <input type="hidden" name="id" value={budget.id} />
            <input type="hidden" name="version" value={String(budget.version)} />
            <input type="hidden" name="status" value="ACTIVE" />
            <Button type="submit" variant="primary" size="sm" loading={pending}>
              Activate it
            </Button>
          </form>
        )}

        {budget.status === 'ACTIVE' && (
          <form action={submit}>
            <input type="hidden" name="id" value={budget.id} />
            <input type="hidden" name="version" value={String(budget.version)} />
            <input type="hidden" name="status" value="CLOSED" />
            <Button type="submit" variant="ghost" size="sm" loading={pending}>
              Close the period
            </Button>
          </form>
        )}
      </CardBody>
    </Card>
  );
}

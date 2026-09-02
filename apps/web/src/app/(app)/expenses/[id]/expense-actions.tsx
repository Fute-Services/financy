'use client';

import { useActionState } from 'react';
import type { ExpenseRecord } from '@financy/contracts';
import { Button, Card, CardBody, CardHeader, FormMessage } from '@financy/ui';

import { IDLE } from '@/lib/form-state';
import { cancelExpense, submitExpense } from '../actions';

/**
 * What can still be done to this claim.
 *
 * The controls that would only ever produce a `403` are absent rather than
 * disabled: a settled claim offers nothing, and a disabled button that never
 * becomes enabled is a promise the screen cannot keep.
 */
export function ExpenseActions({ expense }: { expense: ExpenseRecord }): React.JSX.Element | null {
  const [submitState, submit, submitting] = useActionState(submitExpense, IDLE);
  const [cancelState, cancel, cancelling] = useActionState(cancelExpense, IDLE);

  const canSubmit = expense.status === 'DRAFT' || expense.status === 'CHANGES_REQUESTED';
  const canCancel = expense.status === 'DRAFT' || expense.status === 'PENDING_APPROVAL';

  if (!canSubmit && !canCancel) return null;

  return (
    <Card>
      <CardHeader title="What happens next" />
      <CardBody className="flex flex-col gap-3">
        {submitState.status === 'error' && submitState.message !== undefined && (
          <FormMessage>{submitState.message}</FormMessage>
        )}
        {cancelState.status === 'error' && cancelState.message !== undefined && (
          <FormMessage>{cancelState.message}</FormMessage>
        )}

        {canSubmit && (
          <form action={submit} className="flex flex-col gap-2">
            <input type="hidden" name="id" value={expense.id} />
            <input type="hidden" name="version" value={String(expense.version)} />
            <Button type="submit" variant="primary" loading={submitting}>
              Submit for approval
            </Button>
            <p className="text-[12px] text-ink-500">
              Policy decides at submission. If it needs a receipt and there is none, you will be
              told before anything is decided.
            </p>
          </form>
        )}

        {canCancel && (
          <form action={cancel}>
            <input type="hidden" name="id" value={expense.id} />
            <input type="hidden" name="version" value={String(expense.version)} />
            <Button type="submit" variant="ghost" loading={cancelling}>
              Withdraw this claim
            </Button>
          </form>
        )}
      </CardBody>
    </Card>
  );
}

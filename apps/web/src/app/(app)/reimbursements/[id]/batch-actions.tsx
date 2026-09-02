'use client';

import { useActionState } from 'react';
import type { ReimbursementDetail } from '@financy/contracts';
import { Button, Card, CardBody, CardHeader, FormMessage, Input } from '@financy/ui';

import { IDLE } from '@/lib/form-state';
import { approveReimbursement, cancelReimbursement, payReimbursement } from '../actions';

/**
 * Approve, pay, or cancel.
 *
 * **Paying asks for a reference and will not proceed without one.** A payment
 * nobody can find in a bank statement is a payment nobody can prove was made,
 * and "paid" with no reference is the state a dispute starts from — so the
 * field is required here as well as on the server, where it is enforced.
 *
 * A paid batch offers nothing at all. Money has left the company; the way back
 * is a correction, not a button.
 */
export function BatchActions({
  batch,
  session,
}: {
  batch: ReimbursementDetail;
  session: { permissions: string[] };
}): React.JSX.Element {
  const [approveState, approve, approving] = useActionState(approveReimbursement, IDLE);
  const [payState, pay, paying] = useActionState(payReimbursement, IDLE);
  const [cancelState, cancel, cancelling] = useActionState(cancelReimbursement, IDLE);

  const can = (permission: string): boolean => session.permissions.includes(permission);

  if (batch.status === 'PAID') {
    return (
      <Card>
        <CardHeader title="Paid" />
        <CardBody className="flex flex-col gap-2 text-[13px] text-ink-700">
          <p>
            Recorded against <span className="font-mono">{batch.paymentReference}</span>
            {batch.paidAt !== null && <> on {new Date(batch.paidAt).toLocaleDateString('en-GB')}</>}.
          </p>
          <p className="text-[12px] text-ink-500">
            The claims in this batch are marked reimbursed and cannot be batched again.
          </p>
        </CardBody>
      </Card>
    );
  }

  if (batch.status === 'CANCELLED') {
    return (
      <Card>
        <CardHeader title="Cancelled" />
        <CardBody className="text-[13px] text-ink-600">
          Those claims are free to be batched again.
        </CardBody>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader title="What happens next" />
      <CardBody className="flex flex-col gap-3">
        {[approveState, payState, cancelState].map((state, index) =>
          state.status === 'error' && state.message !== undefined ? (
            <FormMessage key={index}>{state.message}</FormMessage>
          ) : null,
        )}

        {batch.status === 'DRAFT' && can('reimbursement:approve') && (
          <form action={approve}>
            <input type="hidden" name="id" value={batch.id} />
            <input type="hidden" name="version" value={String(batch.version)} />
            <Button type="submit" variant="primary" loading={approving}>
              Approve for payment
            </Button>
          </form>
        )}

        {batch.status === 'APPROVED' && can('reimbursement:mark_paid') && (
          <form action={pay} className="flex flex-col gap-2">
            <input type="hidden" name="id" value={batch.id} />
            <input type="hidden" name="version" value={String(batch.version)} />
            <Input
              name="paymentReference"
              label="Payment reference"
              required
              maxLength={100}
              placeholder="BACS-2026-09-01-0042"
              hint="From the bank. This is what makes the payment provable later."
            />
            <Button type="submit" variant="primary" loading={paying}>
              Mark as paid
            </Button>
          </form>
        )}

        {can('reimbursement:create') && (
          <form action={cancel}>
            <input type="hidden" name="id" value={batch.id} />
            <input type="hidden" name="version" value={String(batch.version)} />
            <Button type="submit" variant="ghost" loading={cancelling}>
              Cancel this batch
            </Button>
          </form>
        )}
      </CardBody>
    </Card>
  );
}

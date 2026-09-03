'use client';

import { useActionState } from 'react';
import type { PurchaseOrderDetail } from '@financy/contracts';
import { Button, Card, CardBody, CardHeader, FormMessage } from '@financy/ui';

import { IDLE } from '@/lib/form-state';
import { cancelOrder, submitOrder } from '../actions';

/**
 * Submitting and cancelling.
 *
 * The cancel button says what cancelling *does* — releases the reservation —
 * because a purchase order's whole point is the budget it holds, and an order
 * cancelled without that being obvious leaves somebody wondering why their
 * department's remaining figure moved.
 */
export function OrderActions({
  order,
  canRaise,
}: {
  order: PurchaseOrderDetail;
  canRaise: boolean;
}): React.JSX.Element | null {
  const [submitState, submit, submitting] = useActionState(submitOrder, IDLE);
  const [cancelState, cancel, cancelling] = useActionState(cancelOrder, IDLE);

  if (!canRaise) return null;

  const draft = order.status === 'DRAFT' || order.status === 'REJECTED';
  const cancellable =
    order.status !== 'RECEIVED' && order.status !== 'CLOSED' && order.status !== 'CANCELLED';

  const error =
    submitState.status === 'error'
      ? submitState.message
      : cancelState.status === 'error'
        ? cancelState.message
        : undefined;

  if (!draft && !cancellable) return null;

  return (
    <Card>
      <CardHeader title="Actions" />
      <CardBody className="flex flex-col gap-3">
        {error !== undefined && <FormMessage>{error}</FormMessage>}

        {draft && (
          <form action={submit} className="flex flex-col gap-2">
            <input type="hidden" name="id" value={order.id} />
            <input type="hidden" name="version" value={String(order.version)} />
            <Button type="submit" variant="primary" size="sm" loading={submitting}>
              Submit for approval
            </Button>
            <p className="text-[12px] text-ink-500">
              Once approved, this reserves its value against the budget it falls in.
            </p>
          </form>
        )}

        {cancellable && (
          <form action={cancel} className="flex flex-col gap-2 border-t border-[var(--border-subtle)] pt-3">
            <input type="hidden" name="id" value={order.id} />
            <input type="hidden" name="version" value={String(order.version)} />
            <Button type="submit" variant="ghost" size="sm" loading={cancelling}>
              Cancel this order
            </Button>
            <p className="text-[12px] text-ink-500">
              Any budget it reserved is released back.
            </p>
          </form>
        )}
      </CardBody>
    </Card>
  );
}

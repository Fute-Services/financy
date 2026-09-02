'use client';

import { useActionState } from 'react';
import type { PurchaseOrderDetail } from '@financy/contracts';
import { Button, Card, CardBody, CardHeader, FormMessage } from '@financy/ui';

import { IDLE } from '@/lib/form-state';
import { receiveOrder } from '../actions';

/**
 * Recording a delivery.
 *
 * **Every box starts empty, pre-filled with nothing.** Defaulting each line to
 * its outstanding quantity would make "receive everything" one press — and make
 * it the press somebody makes without looking at the pallet. The outstanding
 * figure is beside the box, so filling it in is a decision rather than a
 * confirmation.
 *
 * **A negative number is allowed.** A miscount corrected the next morning is a
 * negative receipt, not an edit to yesterday's, because what was recorded on
 * the day the van arrived is what a dispute turns on.
 */
export function ReceivePanel({ order }: { order: PurchaseOrderDetail }): React.JSX.Element {
  const [state, submit, pending] = useActionState(receiveOrder, IDLE);

  return (
    <Card>
      <CardHeader
        title="Record a delivery"
        description="Only the lines you fill in are recorded. Two vans is two entries, not one edited twice."
      />
      <CardBody>
        <form action={submit} className="flex flex-col gap-3">
          <input type="hidden" name="id" value={order.id} />
          <input type="hidden" name="version" value={String(order.version)} />

          {state.status === 'error' && state.message !== undefined && (
            <FormMessage>{state.message}</FormMessage>
          )}
          {state.status === 'success' && state.message !== undefined && (
            <p className="text-[13px] text-[var(--color-success-text)]">{state.message}</p>
          )}

          {order.lines.map((line) => (
            <div key={line.id} className="flex items-center justify-between gap-3">
              <input type="hidden" name="receiveLineId" value={line.id} />
              <div className="min-w-0">
                <div className="truncate text-[13px] text-ink-800">{line.description}</div>
                <div className="text-[12px] text-ink-500">
                  {line.outstandingQuantity} still outstanding
                </div>
              </div>
              <input
                name="receiveQuantity"
                aria-label={`Quantity received for ${line.description}`}
                inputMode="decimal"
                placeholder="0"
                className="tabular h-8 w-24 rounded-[var(--radius-sm)] border border-line px-2 text-right text-[13px]"
              />
            </div>
          ))}

          <div className="flex justify-end">
            <Button type="submit" variant="primary" size="sm" loading={pending}>
              Record it
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}

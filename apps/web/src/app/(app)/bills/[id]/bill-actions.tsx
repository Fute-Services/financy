'use client';

import { useActionState, useState } from 'react';
import type { BillDetail } from '@financy/contracts';
import { Button, Card, CardBody, CardHeader, FormMessage, Input, Textarea } from '@financy/ui';

import { IDLE } from '@/lib/form-state';
import { cancelBill, creditBill, payBill, submitBill } from '../actions';

/**
 * What can be done to this bill, and nothing else.
 *
 * The panel changes with the status rather than showing every action greyed
 * out. A disabled "Pay" on a draft invites somebody to work out why it is
 * disabled; its absence, next to a "Submit" that is present, says the same
 * thing in less time.
 */
export function BillActions({
  bill,
  canEnter,
  canPay,
}: {
  bill: BillDetail;
  canEnter: boolean;
  canPay: boolean;
}): React.JSX.Element | null {
  const [submitState, submit, submitting] = useActionState(submitBill, IDLE);
  const [payState, pay, paying] = useActionState(payBill, IDLE);
  const [creditState, credit, crediting] = useActionState(creditBill, IDLE);
  const [cancelState, cancel, cancelling] = useActionState(cancelBill, IDLE);
  const [creditOpen, setCreditOpen] = useState(false);

  const draft = bill.status === 'DRAFT' || bill.status === 'REJECTED';
  const payable = bill.status === 'APPROVED';
  const correctable = bill.status === 'PAID' || bill.status === 'APPROVED';

  if (!canEnter && !canPay) return null;

  const error =
    submitState.status === 'error'
      ? submitState.message
      : payState.status === 'error'
        ? payState.message
        : creditState.status === 'error'
          ? creditState.message
          : cancelState.status === 'error'
            ? cancelState.message
            : undefined;

  return (
    <Card>
      <CardHeader title="Actions" />
      <CardBody className="flex flex-col gap-3">
        {error !== undefined && <FormMessage>{error}</FormMessage>}

        {draft && canEnter && (
          <form action={submit} className="flex flex-col gap-2">
            <input type="hidden" name="id" value={bill.id} />
            <input type="hidden" name="version" value={String(bill.version)} />
            <Button type="submit" variant="primary" size="sm" loading={submitting}>
              Submit for approval
            </Button>
            <p className="text-[12px] text-ink-500">
              Evaluated against the same policy as every other kind of spend.
            </p>
          </form>
        )}

        {payable && canPay && (
          <form action={pay} className="flex flex-col gap-2">
            <input type="hidden" name="id" value={bill.id} />
            <input type="hidden" name="version" value={String(bill.version)} />
            <Input
              name="paymentReference"
              label="Payment reference"
              required
              maxLength={100}
              hint="A payment nobody can find in a bank statement is one nobody can prove."
            />
            <Button type="submit" variant="primary" size="sm" loading={paying}>
              Record as paid
            </Button>
          </form>
        )}

        {correctable && canEnter && (
          <div className="flex flex-col gap-2 border-t border-[var(--border-subtle)] pt-3">
            {creditOpen ? (
              <form action={credit} className="flex flex-col gap-2">
                <input type="hidden" name="id" value={bill.id} />
                <input type="hidden" name="version" value={String(bill.version)} />
                <input type="hidden" name="currency" value={bill.total.currency} />
                <Textarea name="reason" label="Why" rows={2} required maxLength={500} />
                <Input
                  name="amount"
                  label="Amount"
                  inputMode="decimal"
                  hint="Leave blank to credit the whole invoice."
                />
                <div className="flex gap-2">
                  <Button type="submit" variant="primary" size="sm" loading={crediting}>
                    Raise the credit note
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setCreditOpen(false)}
                  >
                    Cancel
                  </Button>
                </div>
              </form>
            ) : (
              <>
                <Button variant="secondary" size="sm" onClick={() => setCreditOpen(true)}>
                  Raise a credit note
                </Button>
                <p className="text-[12px] text-ink-500">
                  A paid invoice is never edited. A credit note offsets it, which is what the
                  accounts expect to see anyway.
                </p>
              </>
            )}
          </div>
        )}

        {bill.status !== 'PAID' && bill.status !== 'CANCELLED' && canEnter && (
          <form action={cancel} className="border-t border-[var(--border-subtle)] pt-3">
            <input type="hidden" name="id" value={bill.id} />
            <input type="hidden" name="version" value={String(bill.version)} />
            <Button type="submit" variant="ghost" size="sm" loading={cancelling}>
              Cancel this bill
            </Button>
          </form>
        )}
      </CardBody>
    </Card>
  );
}

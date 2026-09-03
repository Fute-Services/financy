'use client';

import { useActionState, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { EntitySummary, Person } from '@financy/contracts';
import { Button, Dialog, FormMessage, Input, Select } from '@financy/ui';

import { IDLE } from '@/lib/form-state';
import { createReimbursement } from './actions';

/**
 * Build a batch.
 *
 * **The form asks for the group, not the claims.** One person, one entity, one
 * currency, one period — every one of those is a constraint on what a payment
 * can be, and letting somebody tick individual expenses would let them assemble
 * a batch that crosses currencies, which is a payment nobody can make.
 *
 * The period defaults to this month, because that is what people mean when they
 * say "pay this month's expenses" and typing two dates to get it is friction
 * with no decision in it.
 */
export function NewBatchButton({
  entities,
  people,
  baseCurrency,
}: {
  entities: readonly EntitySummary[];
  people: readonly Person[];
  baseCurrency: string;
}): React.JSX.Element {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, submit, pending] = useActionState(createReimbursement, IDLE);

  useEffect(() => {
    if (state.status === 'success' && state.createdId !== undefined) {
      setOpen(false);
      router.push(`/reimbursements/${state.createdId}`);
    }
  }, [state, router]);

  const now = new Date();
  const firstOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
    .toISOString()
    .slice(0, 10);
  const today = now.toISOString().slice(0, 10);

  return (
    <>
      <Button variant="primary" onClick={() => setOpen(true)}>
        New batch
      </Button>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Build a reimbursement batch"
        description="Every approved out-of-pocket claim matching this person, entity, currency, and period goes in. Company-card spend never does — the company already paid."
      >
        <form action={submit} className="flex flex-col gap-4">
          {state.status === 'error' && state.message !== undefined && (
            <FormMessage>{state.message}</FormMessage>
          )}

          <Select
            name="payeeMembershipId"
            label="Paying"
            required
            options={people.map((person) => ({ value: person.id, label: person.fullName }))}
          />

          <Select
            name="entityId"
            label="From entity"
            required
            options={entities.map((entity) => ({ value: entity.id, label: entity.name }))}
          />

          <Input
            name="currency"
            label="Currency"
            defaultValue={baseCurrency}
            maxLength={3}
            required
            hint="One payment, one currency. Raise a second batch for the rest."
          />

          <div className="grid grid-cols-2 gap-3">
            <Input name="periodStart" label="From" type="date" defaultValue={firstOfMonth} required />
            <Input name="periodEnd" label="To" type="date" defaultValue={today} required />
          </div>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={pending}>
              Build the batch
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}

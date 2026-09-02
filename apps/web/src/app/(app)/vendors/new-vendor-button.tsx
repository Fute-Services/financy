'use client';

import { useActionState, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Dialog, FormMessage, Input } from '@financy/ui';

import { IDLE } from '@/lib/form-state';
import { createVendor } from './actions';

/**
 * Adding a supplier.
 *
 * ## The duplicate refusal is the interesting part of this form
 *
 * The API answers `409` and names what it matched. Rather than showing a bare
 * error, the form offers the override with the match visible — because the
 * person filling it in is the only one who knows whether "Acme Ltd" and "Acme
 * Limited" are one company or a franchise and its parent, and they can only
 * decide that if they can see both.
 *
 * ## Bank details are optional and go in last
 *
 * Most suppliers are added while somebody is entering an invoice and does not
 * have the payment details in front of them. Making them mandatory would mean
 * inventing one, and an invented account number is worse than an absent one.
 */
export function NewVendorButton(): React.JSX.Element {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, submit, pending] = useActionState(createVendor, IDLE);

  if (state.status === 'success' && open) {
    setOpen(false);
    router.refresh();
  }

  const duplicate = state.status === 'error' && state.code === 'CONFLICT';

  return (
    <>
      <Button variant="primary" onClick={() => setOpen(true)}>
        Add a supplier
      </Button>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Add a supplier"
        description="One row per company. If this looks like one that already exists, you will be told before it is created."
      >
        <form action={submit} className="flex flex-col gap-4">
          {state.status === 'error' && state.message !== undefined && (
            <FormMessage>{state.message}</FormMessage>
          )}

          <Input name="name" label="Name" required maxLength={200} />
          <Input
            name="legalName"
            label="Legal name"
            maxLength={200}
            hint="If it differs from what people call them."
          />

          <div className="grid grid-cols-2 gap-3">
            <Input name="taxId" label="Tax ID" maxLength={64} />
            <Input
              name="paymentTermsDays"
              label="Payment terms"
              type="number"
              defaultValue="30"
              min={0}
              max={365}
              hint="Days. Sets a bill's due date."
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Input name="email" label="Email" type="email" />
            <Input
              name="defaultCurrency"
              label="Usual currency"
              maxLength={3}
              placeholder="USD"
            />
          </div>

          <fieldset className="rounded-[var(--radius-sm)] border border-line p-3">
            <legend className="px-1 text-[12px] text-ink-500">
              Bank details — stored encrypted, and only the last four digits are ever shown again
            </legend>

            <div className="grid grid-cols-2 gap-3">
              <Input name="accountName" label="Account name" maxLength={200} />
              <Input name="accountNumber" label="Account number or IBAN" maxLength={64} />
            </div>
          </fieldset>

          {duplicate && (
            <label className="flex items-start gap-2 rounded-[var(--radius-sm)] border border-[var(--color-warning-border)] bg-[var(--color-warning-bg)] p-3 text-[13px]">
              <input type="checkbox" name="allowDuplicate" className="mt-0.5" />
              <span className="text-[var(--color-warning-text)]">
                This really is a different company from the one above. Add it anyway.
              </span>
            </label>
          )}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={pending}>
              Add
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}

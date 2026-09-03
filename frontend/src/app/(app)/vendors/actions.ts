'use server';

import type { Resource, VendorRecord } from '@financy/contracts';

import { create, optional, runWrite, text, type FormState } from '@/lib/actions';

/**
 * Creating a supplier.
 *
 * **The duplicate refusal is passed through, not swallowed.** The API answers
 * `409` with the suppliers it matched, and the form shows them — a create that
 * silently succeeded would put the second Acme in the list, and a create that
 * silently failed would leave somebody retyping it.
 */
export async function createVendor(_previous: FormState, form: FormData): Promise<FormState> {
  const accountNumber = optional(form, 'accountNumber');

  return runWrite(
    ['/vendors'],
    () =>
      create<Resource<VendorRecord>>('/vendors', {
        name: text(form, 'name'),
        legalName: optional(form, 'legalName'),
        taxId: optional(form, 'taxId'),
        email: optional(form, 'email'),
        countryCode: optional(form, 'countryCode'),
        defaultCurrency: optional(form, 'defaultCurrency'),
        paymentTermsDays: Number(optional(form, 'paymentTermsDays') ?? '30'),
        // Sent only when supplied. An empty object here would store an empty
        // encrypted blob and make `hasBankDetails` true for a supplier with
        // none.
        ...(accountNumber === undefined || accountNumber === ''
          ? {}
          : {
              bankDetails: {
                accountName: optional(form, 'accountName') ?? text(form, 'name'),
                accountNumber,
              },
            }),
        allowDuplicate: form.get('allowDuplicate') === 'on',
      }),
    'Supplier added.',
    (response) => ({ createdId: response.data.id }),
  );
}

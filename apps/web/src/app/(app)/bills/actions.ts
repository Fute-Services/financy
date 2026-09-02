'use server';

import type { BillDetail, Resource } from '@financy/contracts';

import {
  create,
  nullable,
  optional,
  runWrite,
  text,
  version,
  writeWithVersion,
  type FormState,
} from '@/lib/actions';

/**
 * The bill screen's writes.
 *
 * **Paying and correcting are different actions with different shapes.**
 * Marking paid needs a reference and nothing else; correcting a paid bill needs
 * a reason and produces a second record. Offering an "edit" that silently did
 * one or the other depending on status is how somebody changes a figure that
 * has already been reported.
 */
const PATHS = ['/bills', '/overview'];

/**
 * Lines arrive as parallel arrays from the form.
 *
 * A row with no description is a row somebody added and did not fill in, and
 * dropping it is kinder than refusing the whole bill for it.
 */
function billLines(form: FormData): { description: string; quantity: string; unitAmount: string }[] {
  const descriptions = form.getAll('lineDescription');
  const quantities = form.getAll('lineQuantity');
  const amounts = form.getAll('lineUnitAmount');

  return descriptions.flatMap((description, index) => {
    const amount = amounts[index];
    const quantity = quantities[index];

    if (typeof description !== 'string' || description.trim() === '') return [];
    if (typeof amount !== 'string' || amount.trim() === '') return [];

    return [
      {
        description: description.trim(),
        quantity: typeof quantity === 'string' && quantity.trim() !== '' ? quantity.trim() : '1',
        unitAmount: amount.trim(),
      },
    ];
  });
}

export async function createBill(_previous: FormState, form: FormData): Promise<FormState> {
  return runWrite(
    PATHS,
    () =>
      create<Resource<BillDetail>>('/bills', {
        vendorId: text(form, 'vendorId'),
        entityId: text(form, 'entityId'),
        billNumber: text(form, 'billNumber'),
        issueDate: text(form, 'issueDate'),
        ...(optional(form, 'dueDate') === undefined ? {} : { dueDate: text(form, 'dueDate') }),
        currency: text(form, 'currency').toUpperCase(),
        lines: billLines(form),
        memo: optional(form, 'memo'),
      }),
    'Bill entered as a draft.',
    (response) => ({ createdId: response.data.id }),
  );
}

export async function submitBill(_previous: FormState, form: FormData): Promise<FormState> {
  const id = text(form, 'id');

  return runWrite(
    [...PATHS, `/bills/${id}`],
    () =>
      writeWithVersion<Resource<BillDetail>>(`/bills/${id}/submit`, 'POST', version(form), {}),
    'Submitted. Policy decided what happens next.',
  );
}

export async function payBill(_previous: FormState, form: FormData): Promise<FormState> {
  const id = text(form, 'id');

  return runWrite(
    [...PATHS, `/bills/${id}`],
    () =>
      writeWithVersion<Resource<BillDetail>>(`/bills/${id}/pay`, 'POST', version(form), {
        paymentReference: text(form, 'paymentReference'),
      }),
    'Recorded as paid.',
  );
}

export async function creditBill(_previous: FormState, form: FormData): Promise<FormState> {
  const id = text(form, 'id');
  const amount = optional(form, 'amount');

  return runWrite(
    [...PATHS, `/bills/${id}`],
    () =>
      writeWithVersion<Resource<BillDetail>>(`/bills/${id}/credit-note`, 'POST', version(form), {
        reason: text(form, 'reason'),
        // Absent means the whole bill, which is the common case and the one
        // that should not require typing the amount again.
        ...(amount === undefined || amount === ''
          ? {}
          : { amount: { amount, currency: text(form, 'currency').toUpperCase() } }),
      }),
    'Credit note raised.',
    (response) => ({ createdId: response.data.id }),
  );
}

export async function cancelBill(_previous: FormState, form: FormData): Promise<FormState> {
  const id = text(form, 'id');

  return runWrite(
    [...PATHS, `/bills/${id}`],
    () =>
      writeWithVersion<Resource<BillDetail>>(`/bills/${id}/cancel`, 'POST', version(form), {}),
    'Cancelled.',
  );
}

export { nullable };

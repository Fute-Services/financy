'use server';

import type { ExpenseRecord, ReceiptDetail, Resource, UploadIntent } from '@financy/contracts';

import { apiFetch } from '@/lib/api';
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
 * The expense screen's writes.
 *
 * **Creating and submitting are two actions, and the form offers both.** A
 * draft is somewhere to put a claim while the receipt is still on a phone;
 * submitting is what evaluates policy. Collapsing them would mean every
 * half-finished claim gets a policy decision it never asked for.
 */
const PATHS = ['/expenses', '/overview'];

function expenseBody(form: FormData): Record<string, unknown> {
  const items = form.getAll('itemDescription').flatMap((description, index) => {
    const amount = form.getAll('itemAmount')[index];

    if (typeof description !== 'string' || description.trim() === '') return [];
    if (typeof amount !== 'string' || amount.trim() === '') return [];

    return [
      {
        description: description.trim(),
        amount: { amount: amount.trim(), currency: text(form, 'currency').toUpperCase() },
      },
    ];
  });

  const total = optional(form, 'amount');

  return {
    paymentMethod: optional(form, 'paymentMethod') ?? 'OUT_OF_POCKET',
    entityId: text(form, 'entityId'),
    merchantName: text(form, 'merchantName'),
    expenseDate: text(form, 'expenseDate'),
    departmentId: nullable(form, 'departmentId'),
    categoryId: nullable(form, 'categoryId'),
    projectId: nullable(form, 'projectId'),
    memo: optional(form, 'memo'),
    // Exactly one of the two decides the total. Sending both when items exist
    // would make the server refuse a disagreement the person never typed.
    ...(items.length > 0
      ? { items }
      : { amount: { amount: total ?? '', currency: text(form, 'currency').toUpperCase() } }),
  };
}

export async function createExpense(_previous: FormState, form: FormData): Promise<FormState> {
  return runWrite(
    PATHS,
    () => create<Resource<ExpenseRecord>>('/expenses', expenseBody(form)),
    'Saved as a draft.',
    (response) => ({ createdId: response.data.id }),
  );
}

/**
 * Create and submit in one press.
 *
 * Two requests rather than one endpoint, because submission has to happen
 * *after* the receipt is attached and the draft is what the receipt attaches
 * to. A failure between them leaves a draft, which is a state the person can
 * see and finish.
 */
export async function createAndSubmitExpense(
  _previous: FormState,
  form: FormData,
): Promise<FormState> {
  return runWrite(
    PATHS,
    async () => {
      const created = await create<Resource<ExpenseRecord>>('/expenses', expenseBody(form));

      return writeWithVersion<Resource<ExpenseRecord>>(
        `/expenses/${created.data.id}/submit`,
        'POST',
        created.data.version,
        {},
      );
    },
    'Submitted. Policy decided what happens next.',
    (response) => ({ createdId: response.data.id }),
  );
}

export async function submitExpense(_previous: FormState, form: FormData): Promise<FormState> {
  const id = text(form, 'id');

  return runWrite(
    [...PATHS, `/expenses/${id}`],
    () => writeWithVersion<Resource<ExpenseRecord>>(`/expenses/${id}/submit`, 'POST', version(form), {}),
    'Submitted.',
  );
}

export async function cancelExpense(_previous: FormState, form: FormData): Promise<FormState> {
  const id = text(form, 'id');

  return runWrite(
    [...PATHS, `/expenses/${id}`],
    () => writeWithVersion<Resource<ExpenseRecord>>(`/expenses/${id}/cancel`, 'POST', version(form), {}),
    'Withdrawn.',
  );
}

/**
 * Ask for somewhere to put a receipt.
 *
 * Returns the intent to the browser, which uploads the bytes directly. This
 * server action deliberately never touches the file: a 20 MB body through the
 * Next server is 20 MB of memory it did not need to hold.
 */
export async function requestReceiptUpload(input: {
  fileName: string;
  contentType: string;
  byteSize: number;
}): Promise<UploadIntent> {
  const response = await create<Resource<UploadIntent>>('/receipts/upload-intent', input);

  return response.data;
}

export async function completeReceiptUpload(
  receiptId: string,
  attachTo: { targetType: 'expense' | 'transaction'; targetId: string } | null,
): Promise<void> {
  await create<Resource<ReceiptDetail>>(`/receipts/${receiptId}/complete`, {});

  if (attachTo !== null) {
    await create<Resource<ReceiptDetail>>(`/receipts/${receiptId}/attach`, attachTo);
  }
}

export async function detachReceipt(_previous: FormState, form: FormData): Promise<FormState> {
  const receiptId = text(form, 'receiptId');

  return runWrite(
    [...PATHS, `/expenses/${optional(form, 'expenseId') ?? ''}`],
    () => apiFetch<void>(`/receipts/${receiptId}/attach`, { method: 'DELETE' }),
    'Receipt removed from this claim.',
  );
}

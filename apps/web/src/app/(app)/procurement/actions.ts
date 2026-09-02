'use server';

import type { PurchaseOrderDetail, Resource } from '@financy/contracts';

import {
  create,
  optional,
  runWrite,
  text,
  version,
  writeWithVersion,
  type FormState,
} from '@/lib/actions';

/**
 * The procurement screen's writes.
 *
 * **Receiving sends only the lines that arrived.** A form that posted every
 * line with a zero for the ones that did not would append a receipt of nothing
 * against each, and the ledger of deliveries would fill with rows that say a
 * van turned up empty.
 */
const PATHS = ['/procurement', '/overview'];

function orderLines(form: FormData): { description: string; quantity: string; unitAmount: string }[] {
  const descriptions = form.getAll('lineDescription');
  const quantities = form.getAll('lineQuantity');
  const amounts = form.getAll('lineUnitAmount');

  return descriptions.flatMap((description, index) => {
    const amount = amounts[index];
    const quantity = quantities[index];

    if (typeof description !== 'string' || description.trim() === '') return [];
    if (typeof amount !== 'string' || amount.trim() === '') return [];
    if (typeof quantity !== 'string' || quantity.trim() === '') return [];

    return [
      { description: description.trim(), quantity: quantity.trim(), unitAmount: amount.trim() },
    ];
  });
}

export async function createOrder(_previous: FormState, form: FormData): Promise<FormState> {
  return runWrite(
    PATHS,
    () =>
      create<Resource<PurchaseOrderDetail>>('/purchase-orders', {
        vendorId: text(form, 'vendorId'),
        entityId: text(form, 'entityId'),
        currency: text(form, 'currency').toUpperCase(),
        lines: orderLines(form),
        ...(optional(form, 'expectedDate') === undefined
          ? {}
          : { expectedDate: text(form, 'expectedDate') }),
        memo: optional(form, 'memo'),
      }),
    'Order saved as a draft.',
    (response) => ({ createdId: response.data.id }),
  );
}

export async function submitOrder(_previous: FormState, form: FormData): Promise<FormState> {
  const id = text(form, 'id');

  return runWrite(
    [...PATHS, `/procurement/${id}`],
    () =>
      writeWithVersion<Resource<PurchaseOrderDetail>>(
        `/purchase-orders/${id}/submit`,
        'POST',
        version(form),
        {},
      ),
    'Submitted. An approved order reserves its budget straight away.',
  );
}

export async function receiveOrder(_previous: FormState, form: FormData): Promise<FormState> {
  const id = text(form, 'id');

  const lineIds = form.getAll('receiveLineId');
  const quantities = form.getAll('receiveQuantity');

  const lines = lineIds.flatMap((lineId, index) => {
    const quantity = quantities[index];

    if (typeof lineId !== 'string') return [];
    if (typeof quantity !== 'string' || quantity.trim() === '') return [];
    // Zero is not a delivery. Recording one would put a row in the receipt
    // history saying nothing arrived, which is noise in the one log that has to
    // stay readable.
    if (Number(quantity) === 0) return [];

    return [{ purchaseOrderLineId: lineId, quantity: quantity.trim() }];
  });

  if (lines.length === 0) {
    return { status: 'error', message: 'Enter a quantity for at least one line.' };
  }

  return runWrite(
    [...PATHS, `/procurement/${id}`],
    () =>
      writeWithVersion<Resource<PurchaseOrderDetail>>(
        `/purchase-orders/${id}/receive`,
        'POST',
        version(form),
        { lines },
      ),
    'Delivery recorded.',
  );
}

export async function cancelOrder(_previous: FormState, form: FormData): Promise<FormState> {
  const id = text(form, 'id');

  return runWrite(
    [...PATHS, `/procurement/${id}`],
    () =>
      writeWithVersion<Resource<PurchaseOrderDetail>>(
        `/purchase-orders/${id}/cancel`,
        'POST',
        version(form),
        {},
      ),
    'Cancelled, and the budget it reserved has been released.',
  );
}

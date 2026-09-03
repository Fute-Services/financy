'use server';

import type { ReimbursementDetail, Resource } from '@financy/contracts';

import { create, runWrite, text, version, writeWithVersion, type FormState } from '@/lib/actions';

/**
 * The reimbursement screen's writes.
 *
 * **Approving and paying are two actions with two permissions**, and the UI
 * keeps them apart for the same reason the API does: one control doing both
 * would let one person pay themselves.
 */
const PATHS = ['/reimbursements'];

export async function createReimbursement(
  _previous: FormState,
  form: FormData,
): Promise<FormState> {
  return runWrite(
    PATHS,
    () =>
      create<Resource<ReimbursementDetail>>('/reimbursements', {
        payeeMembershipId: text(form, 'payeeMembershipId'),
        entityId: text(form, 'entityId'),
        currency: text(form, 'currency').toUpperCase(),
        periodStart: text(form, 'periodStart'),
        periodEnd: text(form, 'periodEnd'),
      }),
    'Batch built from every approved claim that qualifies.',
    (response) => ({ createdId: response.data.id }),
  );
}

export async function approveReimbursement(
  _previous: FormState,
  form: FormData,
): Promise<FormState> {
  const id = text(form, 'id');

  return runWrite(
    [...PATHS, `/reimbursements/${id}`],
    () =>
      writeWithVersion<Resource<ReimbursementDetail>>(
        `/reimbursements/${id}/approve`,
        'POST',
        version(form),
        {},
      ),
    'Approved. It is ready to pay.',
  );
}

export async function payReimbursement(_previous: FormState, form: FormData): Promise<FormState> {
  const id = text(form, 'id');

  return runWrite(
    [...PATHS, `/reimbursements/${id}`],
    () =>
      writeWithVersion<Resource<ReimbursementDetail>>(
        `/reimbursements/${id}/pay`,
        'POST',
        version(form),
        { paymentReference: text(form, 'paymentReference') },
      ),
    'Recorded as paid. The claims in it are now reimbursed.',
  );
}

export async function cancelReimbursement(
  _previous: FormState,
  form: FormData,
): Promise<FormState> {
  const id = text(form, 'id');

  return runWrite(
    [...PATHS, `/reimbursements/${id}`],
    () =>
      writeWithVersion<Resource<ReimbursementDetail>>(
        `/reimbursements/${id}/cancel`,
        'POST',
        version(form),
        {},
      ),
    'Cancelled. Those claims can be batched again.',
  );
}

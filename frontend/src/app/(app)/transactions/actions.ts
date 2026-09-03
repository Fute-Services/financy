'use server';

import type {
  ImportResult,
  ImportTransactions,
  Resource,
  TransactionDetail,
} from '@financy/contracts';

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
 * The transaction screen's writes.
 *
 * **There is no create and no delete.** A transaction is a record of money that
 * moved: it arrives from a provider or an import, and it is never typed in nor
 * removed when it becomes inconvenient. A correction is an adjustment — a new
 * linked row that leaves the original intact, because somebody has already
 * reconciled against it.
 *
 * `importRows` takes structured rows rather than a file. Parsing the CSV happens
 * in the browser, where the person can see what was found and say which column
 * is which; an endpoint that took the file would have to guess at delimiters and
 * encodings with nobody to ask, and would report its guesses as import failures.
 */

const TRANSACTIONS = '/transactions';

export async function categorizeTransaction(
  _previous: FormState,
  form: FormData,
): Promise<FormState> {
  const id = text(form, 'id');

  return runWrite(
    [TRANSACTIONS, `${TRANSACTIONS}/${id}`],
    () =>
      writeWithVersion<Resource<TransactionDetail>>(`/transactions/${id}`, 'PATCH', version(form), {
        categoryId: nullable(form, 'categoryId'),
        departmentId: nullable(form, 'departmentId'),
        projectId: nullable(form, 'projectId'),
        memo: nullable(form, 'memo'),
      }),
    'Coded.',
  );
}

export async function reviewTransaction(_previous: FormState, form: FormData): Promise<FormState> {
  const id = text(form, 'id');
  const reviewStatus = text(form, 'reviewStatus');

  return runWrite(
    [TRANSACTIONS, `${TRANSACTIONS}/${id}`],
    () =>
      writeWithVersion<Resource<TransactionDetail>>(
        `/transactions/${id}/review`,
        'POST',
        version(form),
        { reviewStatus, note: optional(form, 'note') ?? null },
      ),
    reviewStatus === 'DISPUTED'
      ? 'Marked disputed. It stays in the queue until somebody resolves it.'
      : 'Review recorded.',
  );
}

export async function matchTransaction(_previous: FormState, form: FormData): Promise<FormState> {
  const id = text(form, 'id');
  const spendRequestId = optional(form, 'spendRequestId') ?? null;
  const notApplicable = form.get('notApplicable') === 'true';

  return runWrite(
    [TRANSACTIONS, `${TRANSACTIONS}/${id}`, '/spend'],
    () =>
      writeWithVersion<Resource<TransactionDetail>>(
        `/transactions/${id}/match`,
        'POST',
        version(form),
        { spendRequestId, notApplicable },
      ),
    spendRequestId === null
      ? notApplicable
        ? 'Marked as an unplanned purchase.'
        : 'Unlinked.'
      : 'Linked to the request that authorised it.',
  );
}

export async function adjustTransaction(_previous: FormState, form: FormData): Promise<FormState> {
  const id = text(form, 'id');

  return runWrite(
    [TRANSACTIONS, `${TRANSACTIONS}/${id}`],
    () =>
      create<Resource<TransactionDetail>>(`/transactions/${id}/adjustments`, {
        adjustmentType: text(form, 'adjustmentType'),
        amount: {
          amount: text(form, 'amount'),
          currency: text(form, 'currency').toUpperCase(),
        },
        reason: optional(form, 'reason'),
      }),
    'Adjustment recorded. The original transaction is unchanged, as it must be.',
  );
}

/**
 * Import a parsed batch.
 *
 * Returns the per-row result rather than a `FormState`, because the interesting
 * part of an import is *which* rows did what. "Import complete" is not something
 * anybody can act on; "417 imported, 3 already present, 1 failed on row 88" is.
 */
export async function importRows(
  input: ImportTransactions,
): Promise<{ result: ImportResult | null; error: string | null }> {
  try {
    const response = await create<Resource<ImportResult>>('/transactions/import', input);

    return { result: response.data, error: null };
  } catch (error) {
    return {
      result: null,
      error: error instanceof Error ? error.message : 'The import could not be run.',
    };
  }
}

'use server';

import type { BulkReviewResult, Resource } from '@financy/contracts';

import { create, optional, runWrite, type FormState } from '@/lib/actions';

/**
 * Review a selection in one request.
 *
 * The success message names what was skipped rather than only what worked:
 * "17 reviewed, 3 not settled yet" tells finance which three to come back to,
 * and a bare count sends them looking for the difference themselves.
 */
export async function bulkReview(_previous: FormState, form: FormData): Promise<FormState> {
  const transactionIds = form.getAll('transactionIds').filter(
    (value): value is string => typeof value === 'string' && value !== '',
  );

  const reviewStatus = optional(form, 'reviewStatus') ?? 'REVIEWED';

  return runWrite(
    ['/review', '/transactions'],
    () =>
      create<Resource<BulkReviewResult>>('/transactions/bulk-review', {
        transactionIds,
        reviewStatus,
        note: optional(form, 'note') ?? null,
      }),
    undefined,
    (response) => ({
      status: 'success',
      message:
        response.data.skipped.length === 0
          ? `${String(response.data.reviewed)} reviewed.`
          : `${String(response.data.reviewed)} reviewed. ${String(
              response.data.skipped.length,
            )} left alone: ${response.data.skipped[0]?.reason ?? ''}`,
    }),
  );
}

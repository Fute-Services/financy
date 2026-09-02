'use server';

import type { ExportResult, Resource } from '@financy/contracts';

import { create, optional, runWrite, text, type FormState } from '@/lib/actions';

/**
 * Running an export.
 *
 * **The dry run and the real run are the same action with one flag**, and
 * deliberately so: two code paths would be two definitions of "what would be
 * exported", and the whole value of a dry run is that it is the same query.
 */
export async function runExport(_previous: FormState, form: FormData): Promise<FormState> {
  const dryRun = form.get('dryRun') === 'true';

  return runWrite(
    ['/accounting'],
    () =>
      create<Resource<ExportResult>>('/accounting/exports', {
        periodStart: text(form, 'periodStart'),
        periodEnd: text(form, 'periodEnd'),
        ...(optional(form, 'currency') === undefined
          ? {}
          : { currency: text(form, 'currency').toUpperCase() }),
        dryRun,
      }),
    dryRun ? 'Checked. Nothing was written.' : 'Exported.',
  );
}

export async function closePeriod(_previous: FormState, form: FormData): Promise<FormState> {
  return runWrite(
    ['/accounting'],
    () =>
      create<Resource<unknown>>('/accounting/periods', {
        periodStart: text(form, 'periodStart'),
        periodEnd: text(form, 'periodEnd'),
        note: optional(form, 'note'),
      }),
    'Period closed. Nothing dated inside it will be exported again.',
  );
}

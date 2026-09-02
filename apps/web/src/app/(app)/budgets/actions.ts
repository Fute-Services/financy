'use server';

import type { BudgetDetail, Resource } from '@financy/contracts';

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
 * The budget screen's writes.
 *
 * **Allocation is a `PUT` of an absolute amount, carrying the line's version.**
 * Two people each typing 500 into a form they opened a minute apart must not
 * produce 1,000; the second is told the number moved. A "+500" action could not
 * make that distinction, and the failure would be invisible — the total would
 * simply be wrong and both of them would believe they had set it.
 */
const PATHS = ['/budgets', '/overview'];

export async function createBudget(_previous: FormState, form: FormData): Promise<FormState> {
  const total = optional(form, 'totalAllocated');
  const currency = text(form, 'currency').toUpperCase();
  const scopeType = text(form, 'scopeType');

  return runWrite(
    PATHS,
    () =>
      create<Resource<BudgetDetail>>('/budgets', {
        name: text(form, 'name'),
        scopeType,
        // An organisation-wide budget is drawn around nothing in particular,
        // and the server refuses a scope id on one.
        ...(scopeType === 'ORGANIZATION' ? {} : { scopeId: nullable(form, 'scopeId') }),
        entityId: text(form, 'entityId'),
        currency,
        periodStart: text(form, 'periodStart'),
        periodEnd: text(form, 'periodEnd'),
        periodGranularity: optional(form, 'periodGranularity') ?? 'MONTHLY',
        overspendBehavior: optional(form, 'overspendBehavior') ?? 'WARN',
        ...(total === undefined || total === ''
          ? {}
          : { totalAllocated: { amount: total, currency } }),
      }),
    'Budget created as a draft. Activate it when it should start counting.',
    (response) => ({ createdId: response.data.id }),
  );
}

export async function updateBudget(_previous: FormState, form: FormData): Promise<FormState> {
  const id = text(form, 'id');
  const status = optional(form, 'status');

  return runWrite(
    [...PATHS, `/budgets/${id}`],
    () =>
      writeWithVersion<Resource<BudgetDetail>>(`/budgets/${id}`, 'PATCH', version(form), {
        ...(optional(form, 'name') === undefined ? {} : { name: text(form, 'name') }),
        ...(optional(form, 'overspendBehavior') === undefined
          ? {}
          : { overspendBehavior: text(form, 'overspendBehavior') }),
        ...(status === undefined ? {} : { status }),
      }),
    status === 'ACTIVE'
      ? 'Active. Spend that matches it will draw it down from now on.'
      : status === 'CLOSED'
        ? 'Closed.'
        : 'Saved.',
  );
}

export async function allocate(_previous: FormState, form: FormData): Promise<FormState> {
  const budgetId = text(form, 'budgetId');
  const lineId = text(form, 'lineId');

  return runWrite(
    [...PATHS, `/budgets/${budgetId}`],
    () =>
      writeWithVersion<Resource<BudgetDetail>>(
        `/budgets/${budgetId}/lines/${lineId}/allocation`,
        'PUT',
        version(form),
        {
          amount: {
            amount: text(form, 'amount'),
            currency: text(form, 'currency').toUpperCase(),
          },
          ...(optional(form, 'memo') === undefined ? {} : { memo: text(form, 'memo') }),
        },
      ),
    'Allocation set.',
  );
}

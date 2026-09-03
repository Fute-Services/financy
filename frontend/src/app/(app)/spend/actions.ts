'use server';

import type { Resource, SpendRequestRecord } from '@financy/contracts';

import { revalidatePath } from 'next/cache';

import {
  create,
  nullable,
  optional,
  runWrite,
  text,
  toFormState,
  version,
  writeWithVersion,
  type FormState,
} from '@/lib/actions';

/**
 * The spend screen's writes.
 *
 * **Create and submit are two calls, and the form makes two of them.** The API
 * has no route from "nothing" to "submitted", deliberately: creating produces a
 * draft, and submitting is what evaluates policy, records the decision, and
 * opens the chain. `createAndSubmit` below does both in sequence and reports
 * honestly if the second half fails — the draft exists, and saying otherwise
 * would leave the person creating a second one.
 *
 * **Nothing here sends a status.** There is no write schema on the server that
 * accepts one, and there is no path from `DRAFT` to `APPROVED` that does not
 * run through the policy engine.
 */

const SPEND = '/spend';

function body(form: FormData): Record<string, unknown> {
  return {
    amount: {
      amount: text(form, 'amount'),
      currency: text(form, 'currency').toUpperCase(),
    },
    entityId: text(form, 'entityId'),
    departmentId: optional(form, 'departmentId') ?? null,
    projectId: optional(form, 'projectId') ?? null,
    categoryId: optional(form, 'categoryId') ?? null,
    purpose: optional(form, 'purpose'),
    memo: nullable(form, 'memo'),
    neededBy: nullable(form, 'neededBy'),
  };
}

export async function createDraft(_previous: FormState, form: FormData): Promise<FormState> {
  return runWrite(
    [SPEND],
    () => create<Resource<SpendRequestRecord>>('/spend-requests', body(form)),
    'Saved as a draft. It is not with anybody until you submit it.',
    (response) => ({ createdId: response.data.id }),
  );
}

/**
 * Create it and submit it in one gesture.
 *
 * Two API calls, because the API has no route that does both — and it should
 * not: a create that could arrive already submitted would be a create that
 * evaluates policy, and every control in the product hangs off submission being
 * its own deliberate act.
 *
 * If the submit fails — policy blocked it, a required memo is missing — the
 * draft still exists and the person is told so, with its id. The alternative,
 * reporting a flat failure, is how somebody ends up with four identical drafts.
 */
export async function createAndSubmit(_previous: FormState, form: FormData): Promise<FormState> {
  let draft: SpendRequestRecord;

  try {
    draft = (await create<Resource<SpendRequestRecord>>('/spend-requests', body(form))).data;
  } catch (error) {
    return toFormState(error);
  }

  // The draft exists from here on, whatever happens next. Both branches below
  // revalidate for that reason: a failed submit still changed the list.
  const submitted = await runWrite(
    [SPEND, `${SPEND}/${draft.id}`, '/approvals'],
    () =>
      writeWithVersion<Resource<SpendRequestRecord>>(
        `/spend-requests/${draft.id}/submit`,
        'POST',
        draft.version,
      ),
    'Submitted. The approval chain is open.',
  );

  if (submitted.status === 'success') return { ...submitted, createdId: draft.id };

  revalidatePath(SPEND);

  return {
    ...submitted,
    // The draft survives a failed submit — policy blocked it, a required memo
    // is missing. Saying so is the difference between the person fixing it and
    // raising the whole thing again from scratch.
    createdId: draft.id,
    message: `${submitted.message ?? 'It could not be submitted.'} Your draft was saved — open it, fix this, and submit again.`,
  };
}

export async function updateDraft(_previous: FormState, form: FormData): Promise<FormState> {
  const id = text(form, 'id');

  return runWrite(
    [SPEND, `${SPEND}/${id}`],
    () =>
      writeWithVersion<Resource<SpendRequestRecord>>(
        `/spend-requests/${id}`,
        'PATCH',
        version(form),
        body(form),
      ),
    'Saved.',
  );
}

export async function submitRequest(_previous: FormState, form: FormData): Promise<FormState> {
  const id = text(form, 'id');

  return runWrite(
    [SPEND, `${SPEND}/${id}`, '/approvals'],
    () =>
      writeWithVersion<Resource<SpendRequestRecord>>(
        `/spend-requests/${id}/submit`,
        'POST',
        version(form),
      ),
    'Submitted.',
  );
}

export async function cancelRequest(_previous: FormState, form: FormData): Promise<FormState> {
  const id = text(form, 'id');

  return runWrite(
    [SPEND, `${SPEND}/${id}`, '/approvals'],
    () =>
      writeWithVersion<Resource<SpendRequestRecord>>(
        `/spend-requests/${id}/cancel`,
        'POST',
        version(form),
      ),
    'Withdrawn.',
  );
}

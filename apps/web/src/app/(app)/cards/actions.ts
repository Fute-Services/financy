'use server';

import type { CardDetail, Resource } from '@financy/contracts';

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
 * The card screen's writes.
 *
 * **Freezing, unfreezing, and terminating are three actions, not one toggle.**
 * The API models them separately because they are different powers with
 * different permissions, and a UI that collapsed them would have to guess which
 * one the person meant — with termination being the guess nobody can undo.
 *
 * Every one of them carries a reason, and the reason is not decoration: the
 * cardholder sees it. A card that stopped working with no explanation is a
 * support ticket, and more often a person quietly deciding the system is broken.
 */

const CARDS = '/cards';

export async function issueCard(_previous: FormState, form: FormData): Promise<FormState> {
  return runWrite(
    [CARDS],
    () =>
      create<Resource<CardDetail>>('/cards', {
        name: optional(form, 'name'),
        cardType: optional(form, 'cardType') ?? 'VIRTUAL',
        holderMembershipId: text(form, 'holderMembershipId'),
        entityId: text(form, 'entityId'),
        departmentId: nullable(form, 'departmentId'),
        categoryId: nullable(form, 'categoryId'),
        limit: {
          amount: text(form, 'limitAmount'),
          currency: text(form, 'limitCurrency').toUpperCase(),
        },
        limitPeriod: text(form, 'limitPeriod'),
      }),
    'Card issued.',
    (response) => ({ createdId: response.data.id }),
  );
}

export async function updateCard(_previous: FormState, form: FormData): Promise<FormState> {
  const id = text(form, 'id');

  return runWrite(
    [CARDS, `${CARDS}/${id}`],
    () =>
      writeWithVersion<Resource<CardDetail>>(`/cards/${id}`, 'PATCH', version(form), {
        name: optional(form, 'name'),
        departmentId: nullable(form, 'departmentId'),
        categoryId: nullable(form, 'categoryId'),
      }),
    'Card updated.',
  );
}

export async function setCardLimit(_previous: FormState, form: FormData): Promise<FormState> {
  const id = text(form, 'id');

  return runWrite(
    [CARDS, `${CARDS}/${id}`],
    () =>
      writeWithVersion<Resource<CardDetail>>(`/cards/${id}/limit`, 'POST', version(form), {
        limit: {
          amount: text(form, 'limitAmount'),
          currency: text(form, 'limitCurrency').toUpperCase(),
        },
        limitPeriod: text(form, 'limitPeriod'),
        reason: optional(form, 'reason'),
      }),
    'Limit changed. The previous one stays in the card’s history.',
  );
}

export async function changeCardStatus(_previous: FormState, form: FormData): Promise<FormState> {
  const id = text(form, 'id');
  const route = text(form, 'route');

  return runWrite(
    [CARDS, `${CARDS}/${id}`],
    () =>
      writeWithVersion<Resource<CardDetail>>(`/cards/${id}/${route}`, 'POST', version(form), {
        reason: optional(form, 'reason'),
      }),
    STATUS_MESSAGES[route] ?? 'Card updated.',
  );
}

const STATUS_MESSAGES: Readonly<Record<string, string>> = {
  freeze: 'Frozen. Nothing can be charged to it until you unfreeze it.',
  unfreeze: 'Unfrozen. It works again.',
  terminate: 'Terminated. This is permanent — issue a new card if one is needed.',
};

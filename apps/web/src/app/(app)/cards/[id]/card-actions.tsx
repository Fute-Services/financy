'use client';

import { useActionState, useEffect, useState } from 'react';
import { LIMIT_PERIODS, LIMIT_PERIOD_LABELS, type CardDetail } from '@financy/contracts';
import { Button, Dialog, FormMessage, Input, Select, Textarea } from '@financy/ui';

import { IDLE } from '@/lib/form-state';
import { changeCardStatus, setCardLimit } from '../actions';

/**
 * What can be done to a card.
 *
 * **Three buttons, three permissions, and no toggle.** Freezing is reversible
 * and is what somebody does when a card is mislaid; terminating is permanent
 * because the issuer destroys the credential. A single "deactivate" doing
 * whichever seemed right is how a card somebody would have found in an hour
 * gets thrown away, so the destructive one is separated, styled as destructive,
 * and asks for confirmation in its own words.
 *
 * **Every action takes a reason, and the holder sees it.** A card that stopped
 * working with no explanation is a support ticket — and more often, a person
 * quietly concluding the system is broken.
 *
 * A terminated card shows no actions at all, because the API refuses every
 * transition out of it. Rendering buttons that only ever answer `409` teaches
 * people to ignore buttons.
 *
 * The permissions arrive as booleans rather than as a session. `@/lib/session`
 * is `server-only` — it reads the httpOnly cookie — so importing it here is a
 * build error rather than a subtle leak, which is exactly the property that
 * module's marker exists for. The server component resolves them and passes
 * three flags.
 */
export function CardActions({
  card,
  canLock,
  canTerminate,
  canSetLimit,
}: {
  card: CardDetail;
  canLock: boolean;
  canTerminate: boolean;
  canSetLimit: boolean;
}): React.JSX.Element | null {
  const [dialog, setDialog] = useState<'limit' | 'freeze' | 'unfreeze' | 'terminate' | null>(null);

  if (card.status === 'TERMINATED') {
    return <span className="text-[13px] text-ink-400">Terminated cards cannot be changed.</span>;
  }

  if (!canLock && !canTerminate && !canSetLimit) return null;

  return (
    <>
      <div className="flex items-center gap-2">
        {canSetLimit && (
          <Button size="sm" onClick={() => setDialog('limit')}>
            Change limit
          </Button>
        )}

        {canLock &&
          (card.status === 'FROZEN' ? (
            <Button size="sm" variant="primary" onClick={() => setDialog('unfreeze')}>
              Unfreeze
            </Button>
          ) : (
            <Button size="sm" onClick={() => setDialog('freeze')}>
              Freeze
            </Button>
          ))}

        {canTerminate && (
          <Button size="sm" variant="danger-subtle" onClick={() => setDialog('terminate')}>
            Terminate
          </Button>
        )}
      </div>

      <LimitDialog card={card} open={dialog === 'limit'} onClose={() => setDialog(null)} />

      <StatusDialog
        card={card}
        route={dialog === 'freeze' ? 'freeze' : dialog === 'unfreeze' ? 'unfreeze' : 'terminate'}
        open={dialog === 'freeze' || dialog === 'unfreeze' || dialog === 'terminate'}
        onClose={() => setDialog(null)}
      />
    </>
  );
}

function LimitDialog({
  card,
  open,
  onClose,
}: {
  card: CardDetail;
  open: boolean;
  onClose: () => void;
}): React.JSX.Element {
  const [state, action, pending] = useActionState(setCardLimit, IDLE);

  useEffect(() => {
    if (state.status === 'success') onClose();
  }, [state, onClose]);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Change the limit"
      description="The previous limit stays in the card’s history, with your reason attached."
    >
      <form action={action} className="flex flex-col gap-4">
        <input type="hidden" name="id" value={card.id} />
        <input type="hidden" name="version" value={card.version} />

        {state.status === 'error' && state.message !== undefined && (
          <FormMessage>{state.message}</FormMessage>
        )}

        <div className="grid grid-cols-[1fr_90px_150px] gap-3">
          <Input
            name="limitAmount"
            label="Limit"
            required
            inputMode="decimal"
            defaultValue={card.limit.amount}
            className="tabular text-right"
            error={state.fields?.['limit']?.[0]}
          />
          <Input
            name="limitCurrency"
            label="Currency"
            required
            defaultValue={card.limit.currency}
            maxLength={3}
            className="uppercase"
          />
          <Select
            name="limitPeriod"
            label="Resets"
            required
            options={LIMIT_PERIODS.map((period) => ({
              value: period,
              label: LIMIT_PERIOD_LABELS[period],
            }))}
            defaultValue={card.limitPeriod}
            error={state.fields?.['limitPeriod']?.[0]}
          />
        </div>

        <Textarea
          name="reason"
          label="Why"
          required
          rows={2}
          maxLength={300}
          placeholder="Q4 campaign budget approved at the November review."
          hint="Recorded permanently. This is what answers “who raised it, and why?”"
          error={state.fields?.['reason']?.[0]}
        />

        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={pending}>
            Change limit
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

const COPY: Readonly<
  Record<'freeze' | 'unfreeze' | 'terminate', { title: string; description: string; verb: string }>
> = {
  freeze: {
    title: 'Freeze this card',
    description:
      'Nothing can be charged to it until you unfreeze it. Reversible — this is what to do with a card somebody has mislaid.',
    verb: 'Freeze',
  },
  unfreeze: {
    title: 'Unfreeze this card',
    description: 'It works again immediately, with the limit it had before.',
    verb: 'Unfreeze',
  },
  terminate: {
    title: 'Terminate this card',
    description:
      'Permanent. The issuer destroys the credential and there is no way back — if the card turns up, a new one has to be issued. Freeze it instead if you are not certain.',
    verb: 'Terminate',
  },
};

function StatusDialog({
  card,
  route,
  open,
  onClose,
}: {
  card: CardDetail;
  route: 'freeze' | 'unfreeze' | 'terminate';
  open: boolean;
  onClose: () => void;
}): React.JSX.Element {
  const [state, action, pending] = useActionState(changeCardStatus, IDLE);

  useEffect(() => {
    if (state.status === 'success') onClose();
  }, [state, onClose]);

  const copy = COPY[route];

  return (
    <Dialog open={open} onClose={onClose} title={copy.title} description={copy.description}>
      <form action={action} className="flex flex-col gap-4">
        <input type="hidden" name="id" value={card.id} />
        <input type="hidden" name="version" value={card.version} />
        <input type="hidden" name="route" value={route} />

        {state.status === 'error' && state.message !== undefined && (
          <FormMessage>{state.message}</FormMessage>
        )}

        <Textarea
          name="reason"
          label="Reason"
          required
          rows={2}
          maxLength={300}
          placeholder={
            route === 'freeze'
              ? 'Card reported lost on the 3rd.'
              : route === 'terminate'
                ? 'Holder has left the organisation.'
                : 'Card found.'
          }
          hint="The cardholder sees this. A card that stops working with no explanation is a support ticket."
          error={state.fields?.['reason']?.[0]}
        />

        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant={route === 'terminate' ? 'danger' : 'primary'}
            loading={pending}
          >
            {copy.verb}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

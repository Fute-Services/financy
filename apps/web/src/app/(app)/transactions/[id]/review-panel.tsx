'use client';

import { useActionState, useEffect, useState } from 'react';
import type { SpendRequestRecord, TransactionDetail } from '@financy/contracts';
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  Dialog,
  FormMessage,
  Input,
  Select,
  Textarea,
} from '@financy/ui';

import { IDLE } from '@/lib/form-state';
import { adjustTransaction, matchTransaction, reviewTransaction } from '../actions';

/**
 * Finance's three actions on a charge: review it, link it, correct it.
 *
 * **Reviewing is one click for the ordinary case and a sentence for the
 * exception.** Marking something reviewed is agreeing with it and needs no
 * explanation; disputing it is somebody else's next action, and a disputed
 * charge with no reason sits in the queue forever while two people wait for
 * each other. The API enforces the same rule.
 *
 * **"Unplanned" is a first-class answer.** A charge with no authorisation is
 * often perfectly fine, and a queue that can only express "matched" or "not yet
 * matched" never empties — the reviewer has no way to say they have looked and
 * concluded there was nothing to match.
 *
 * **A correction never edits the charge.** The original figure has been
 * reconciled against, so a refund is a new linked row and the arithmetic is
 * done across both.
 */
export function ReviewPanel({
  transaction,
  approvedRequests,
}: {
  transaction: TransactionDetail;
  approvedRequests: readonly SpendRequestRecord[];
}): React.JSX.Element {
  const [dialog, setDialog] = useState<'dispute' | 'match' | 'adjust' | null>(null);
  const [reviewState, review, reviewing] = useActionState(reviewTransaction, IDLE);

  const settled = transaction.status === 'POSTED';

  return (
    <Card className="self-start">
      <CardHeader
        title="Finance review"
        description={
          settled
            ? 'Confirm this is right, or say what is wrong with it.'
            : 'Nothing to review yet — this has not settled, so its amount can still change.'
        }
      />

      <CardBody className="flex flex-col gap-3">
        {reviewState.status === 'error' && reviewState.message !== undefined && (
          <FormMessage>{reviewState.message}</FormMessage>
        )}

        {transaction.reviewNote !== null && transaction.reviewNote !== '' && (
          <div className="rounded-[var(--radius-sm)] bg-ink-50/70 px-2.5 py-2 text-[13px] text-ink-700">
            <span className="font-medium">{transaction.reviewedBy ?? 'Someone'}:</span>{' '}
            {transaction.reviewNote}
          </div>
        )}

        {settled && (
          <form action={review} className="flex flex-wrap gap-2">
            <input type="hidden" name="id" value={transaction.id} />
            <input type="hidden" name="version" value={transaction.version} />
            <input type="hidden" name="reviewStatus" value="REVIEWED" />

            <Button
              type="submit"
              size="sm"
              variant="primary"
              loading={reviewing}
              disabled={transaction.reviewStatus === 'REVIEWED'}
            >
              {transaction.reviewStatus === 'REVIEWED' ? 'Reviewed' : 'Mark reviewed'}
            </Button>

            <Button
              type="button"
              size="sm"
              variant="danger-subtle"
              onClick={() => setDialog('dispute')}
            >
              Dispute
            </Button>
          </form>
        )}

        <div className="flex flex-wrap gap-2 border-t border-[var(--border-subtle)] pt-3">
          <Button size="sm" onClick={() => setDialog('match')}>
            {transaction.spendRequestId === null ? 'Link to a request' : 'Change the link'}
          </Button>

          {settled && (
            <Button size="sm" variant="ghost" onClick={() => setDialog('adjust')}>
              Record a correction
            </Button>
          )}
        </div>
      </CardBody>

      <DisputeDialog
        transaction={transaction}
        open={dialog === 'dispute'}
        onClose={() => setDialog(null)}
      />
      <MatchDialog
        transaction={transaction}
        requests={approvedRequests}
        open={dialog === 'match'}
        onClose={() => setDialog(null)}
      />
      <AdjustDialog
        transaction={transaction}
        open={dialog === 'adjust'}
        onClose={() => setDialog(null)}
      />
    </Card>
  );
}

function DisputeDialog({
  transaction,
  open,
  onClose,
}: {
  transaction: TransactionDetail;
  open: boolean;
  onClose: () => void;
}): React.JSX.Element {
  const [state, action, pending] = useActionState(reviewTransaction, IDLE);

  useEffect(() => {
    if (state.status === 'success') onClose();
  }, [state, onClose]);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Dispute this charge"
      description="It stays in the review queue, marked disputed, until somebody resolves it."
    >
      <form action={action} className="flex flex-col gap-4">
        <input type="hidden" name="id" value={transaction.id} />
        <input type="hidden" name="version" value={transaction.version} />
        <input type="hidden" name="reviewStatus" value="DISPUTED" />

        {state.status === 'error' && state.message !== undefined && (
          <FormMessage>{state.message}</FormMessage>
        )}

        <Textarea
          name="note"
          label="What is wrong with it"
          required
          rows={3}
          maxLength={1000}
          placeholder="Charged twice — the same amount appears on the 14th."
          hint="Somebody has to act on this. A dispute with no reason cannot be resolved."
          error={state.fields?.['note']?.[0]}
        />

        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="danger" loading={pending}>
            Dispute
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function MatchDialog({
  transaction,
  requests,
  open,
  onClose,
}: {
  transaction: TransactionDetail;
  requests: readonly SpendRequestRecord[];
  open: boolean;
  onClose: () => void;
}): React.JSX.Element {
  const [state, action, pending] = useActionState(matchTransaction, IDLE);

  useEffect(() => {
    if (state.status === 'success') onClose();
  }, [state, onClose]);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Link to an authorisation"
      description="Which approved request this charge fulfils — or that it was a genuine unplanned purchase."
    >
      <form action={action} className="flex flex-col gap-4">
        <input type="hidden" name="id" value={transaction.id} />
        <input type="hidden" name="version" value={transaction.version} />

        {state.status === 'error' && state.message !== undefined && (
          <FormMessage>{state.message}</FormMessage>
        )}

        <Select
          name="spendRequestId"
          label="Approved request"
          options={[
            { value: '', label: 'None' },
            ...requests.map((request) => ({
              value: request.id,
              label: `${request.reference} · ${request.purpose} · ${request.amount.amount} ${request.amount.currency}`,
            })),
          ]}
          defaultValue={transaction.spendRequestId ?? ''}
          hint={
            requests.length === 0
              ? 'No approved requests to choose from.'
              : 'Only approved requests can be linked — an unapproved one authorises nothing.'
          }
          error={state.fields?.['spendRequestId']?.[0]}
        />

        <label className="flex items-start gap-2 text-[13px] text-ink-700">
          <input type="checkbox" name="notApplicable" value="true" className="mt-0.5 size-3.5" />
          <span>
            There was no request, and that is fine
            <span className="block text-[12px] text-ink-500">
              Marks it an unplanned purchase, so it stops appearing as unmatched work.
            </span>
          </span>
        </label>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={pending}>
            Save
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function AdjustDialog({
  transaction,
  open,
  onClose,
}: {
  transaction: TransactionDetail;
  open: boolean;
  onClose: () => void;
}): React.JSX.Element {
  const [state, action, pending] = useActionState(adjustTransaction, IDLE);

  useEffect(() => {
    if (state.status === 'success') onClose();
  }, [state, onClose]);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Record a correction"
      description="The original transaction is never edited — somebody has already reconciled against it. This adds a linked row."
    >
      <form action={action} className="flex flex-col gap-4">
        <input type="hidden" name="id" value={transaction.id} />

        {state.status === 'error' && state.message !== undefined && (
          <FormMessage>{state.message}</FormMessage>
        )}

        <Select
          name="adjustmentType"
          label="What kind"
          required
          options={[
            { value: 'REFUND', label: 'Refund' },
            { value: 'CHARGEBACK', label: 'Chargeback' },
            { value: 'FEE', label: 'Fee' },
            { value: 'CORRECTION', label: 'Correction' },
          ]}
          defaultValue="REFUND"
          error={state.fields?.['adjustmentType']?.[0]}
        />

        <div className="grid grid-cols-[1fr_100px] gap-3">
          <Input
            name="amount"
            label="Amount"
            required
            inputMode="decimal"
            className="tabular text-right"
            error={state.fields?.['amount']?.[0]}
          />
          <Input
            name="currency"
            label="Currency"
            required
            defaultValue={transaction.amount.currency}
            maxLength={3}
            className="uppercase"
            hint="Must match."
          />
        </div>

        <Textarea
          name="reason"
          label="Why"
          required
          rows={2}
          maxLength={500}
          placeholder="Merchant refunded the duplicate charge on the 21st."
          error={state.fields?.['reason']?.[0]}
        />

        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={pending}>
            Record it
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

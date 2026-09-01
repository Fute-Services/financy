'use client';

import { useActionState, useEffect, useState } from 'react';
import type { SpendRequestRecord } from '@financy/contracts';
import { Button, Dialog, FormMessage } from '@financy/ui';

import { IDLE } from '@/lib/form-state';
import { cancelRequest, submitRequest } from '../actions';

/**
 * What the requester can still do to their own request.
 *
 * **Only actions the API would actually accept are rendered.** Submit appears
 * on a draft and on one that was sent back; withdraw appears while it is
 * undecided. A button that fires straight into a `409` teaches people to ignore
 * buttons, which docs/19 §5 names as an anti-pattern for exactly this reason.
 *
 * **Withdrawing is the requester's alone.** An administrator who wants it
 * stopped rejects it through the chain, which records who decided and why —
 * cancelling on somebody's behalf would erase that distinction, and the API
 * refuses it.
 *
 * Submitting is confirmed rather than immediate. It is the act that evaluates
 * policy and puts the request in other people's queues, and it cannot be
 * quietly undone.
 */
export function RequestActions({
  request,
  isRequester,
  canCancel,
}: {
  request: SpendRequestRecord;
  isRequester: boolean;
  canCancel: boolean;
}): React.JSX.Element | null {
  const [dialog, setDialog] = useState<'submit' | 'cancel' | null>(null);

  const submittable =
    isRequester && (request.status === 'DRAFT' || request.status === 'CHANGES_REQUESTED');

  const cancellable =
    isRequester &&
    canCancel &&
    ['DRAFT', 'SUBMITTED', 'PENDING_APPROVAL', 'CHANGES_REQUESTED'].includes(request.status);

  if (!submittable && !cancellable) return null;

  return (
    <>
      <div className="flex items-center gap-2">
        {cancellable && (
          <Button size="sm" variant="ghost" onClick={() => setDialog('cancel')}>
            Withdraw
          </Button>
        )}
        {submittable && (
          <Button size="sm" variant="primary" onClick={() => setDialog('submit')}>
            {request.status === 'CHANGES_REQUESTED' ? 'Submit again' : 'Submit'}
          </Button>
        )}
      </div>

      <ConfirmDialog
        kind="submit"
        request={request}
        open={dialog === 'submit'}
        onClose={() => setDialog(null)}
      />
      <ConfirmDialog
        kind="cancel"
        request={request}
        open={dialog === 'cancel'}
        onClose={() => setDialog(null)}
      />
    </>
  );
}

function ConfirmDialog({
  kind,
  request,
  open,
  onClose,
}: {
  kind: 'submit' | 'cancel';
  request: SpendRequestRecord;
  open: boolean;
  onClose: () => void;
}): React.JSX.Element {
  const [state, action, pending] = useActionState(
    kind === 'submit' ? submitRequest : cancelRequest,
    IDLE,
  );

  useEffect(() => {
    if (state.status === 'success') onClose();
  }, [state, onClose]);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      width="sm"
      title={kind === 'submit' ? 'Submit this request' : 'Withdraw this request'}
      description={
        kind === 'submit'
          ? 'Policy is evaluated now, and any approval chain it calls for opens immediately. You will not be able to edit it afterwards.'
          : 'It stops here. Any approval chain is closed and nobody is asked for anything further.'
      }
    >
      <form action={action} className="flex flex-col gap-4">
        <input type="hidden" name="id" value={request.id} />
        <input type="hidden" name="version" value={request.version} />

        {state.status === 'error' && state.message !== undefined && (
          <FormMessage>{state.message}</FormMessage>
        )}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant={kind === 'submit' ? 'primary' : 'danger'}
            loading={pending}
          >
            {kind === 'submit' ? 'Submit' : 'Withdraw'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

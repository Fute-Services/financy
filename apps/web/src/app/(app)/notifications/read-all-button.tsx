'use client';

import { useActionState } from 'react';
import { Button } from '@financy/ui';

import { IDLE } from '@/lib/form-state';
import { markAllNotificationsRead } from './actions';

/**
 * Mark everything read.
 *
 * Rendered only when there is something unread — a control that does nothing
 * is a control people press to find out what it does.
 *
 * No confirmation. Marking as read destroys nothing and is trivially
 * reversible by looking: the notifications are all still there, in the same
 * order, one filter away.
 */
export function ReadAllButton(): React.JSX.Element {
  const [state, markAll, pending] = useActionState(markAllNotificationsRead, IDLE);

  return (
    <span className="flex items-center gap-2">
      {state.status === 'error' && (
        <span className="text-[12px] text-[var(--color-danger-text)]">{state.message}</span>
      )}
      <form action={markAll}>
        <Button type="submit" variant="ghost" size="sm" disabled={pending}>
          {pending ? 'Marking…' : 'Mark all read'}
        </Button>
      </form>
    </span>
  );
}

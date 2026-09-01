'use client';

import { useActionState } from 'react';
import type { NotificationEvent, NotificationPreferenceRecord } from '@financy/contracts';
import { Button, FormMessage } from '@financy/ui';

import { IDLE } from '@/lib/form-state';
import { saveNotificationPreferences } from './actions';

/**
 * What this person gets told about, per event, per channel.
 *
 * ## The grid is the whole set, saved in one request
 *
 * Somebody ticks four boxes and presses save once. Nine separate requests
 * would give nine chances to half-apply, and a half-applied grid is a person
 * who believes they turned four things off and turned two off.
 *
 * ## In-app cannot be turned off, and that is not an oversight
 *
 * The record is written either way — "I was never told" has to stay
 * answerable — so a switch that hid it in the app while the row existed would
 * be a switch that makes the product lie to the person who set it. Email is
 * the channel with a real cost to the recipient, and that is the one they
 * control.
 */
export function PreferenceGrid({
  preferences,
  labels,
}: {
  preferences: NotificationPreferenceRecord[];
  labels: Readonly<Record<NotificationEvent, string>>;
}): React.JSX.Element {
  const [state, save, pending] = useActionState(saveNotificationPreferences, IDLE);

  return (
    <form action={save} className="flex flex-col gap-3">
      <div className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1 text-[13px]">
        <span className="pb-1 text-[11px] font-medium uppercase tracking-wide text-ink-500">
          Event
        </span>
        <span className="pb-1 text-[11px] font-medium uppercase tracking-wide text-ink-500">
          Email
        </span>

        {preferences.map((preference) => (
          <Row
            key={preference.eventType}
            preference={preference}
            label={labels[preference.eventType]}
          />
        ))}
      </div>

      <p className="text-[12px] text-ink-500">
        Everything still appears in this list. Turning email off changes what reaches your inbox,
        not what the record says you were told.
      </p>

      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? 'Saving…' : 'Save preferences'}
        </Button>
        {state.status !== 'idle' && state.message !== undefined && (
          <FormMessage tone={state.status === 'success' ? 'success' : 'danger'}>
            {state.message}
          </FormMessage>
        )}
      </div>
    </form>
  );
}

function Row({
  preference,
  label,
}: {
  preference: NotificationPreferenceRecord;
  label: string;
}): React.JSX.Element {
  return (
    <>
      <label
        htmlFor={`email:${preference.eventType}`}
        className="py-1.5 text-ink-700"
        title={preference.isDefault ? 'Currently the default for everybody.' : 'You chose this.'}
      >
        {label}
      </label>

      <span className="flex justify-end py-1.5">
        {/*
          `inApp` travels as a hidden input rather than a disabled checkbox: a
          disabled box sends nothing, and the action reads absence as "off" —
          which would silently switch off the in-app copy of everything the
          first time anybody saved.
        */}
        <input type="hidden" name={`inApp:${preference.eventType}`} value="on" />
        <input
          id={`email:${preference.eventType}`}
          type="checkbox"
          name={`email:${preference.eventType}`}
          defaultChecked={preference.email}
          className="size-4 accent-[var(--color-accent-solid)]"
        />
      </span>
    </>
  );
}

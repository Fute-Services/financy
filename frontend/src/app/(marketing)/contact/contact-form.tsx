'use client';

import { useActionState, useState } from 'react';

import { CONTACT_FIELDS } from '@/components/marketing/content';
import { COLOR, EYEBROW, LINE } from '@/components/marketing/theme';
import { IDLE } from '@/lib/form-state';

import { submitDemoRequest } from './actions';

const INPUT =
  'w-full rounded border bg-[#FBFBFA] px-3 py-[11px] text-[15px] outline-none transition-colors';

const OK_BORDER = 'border-[rgba(20,22,26,0.16)] focus:border-[#2B39C4]';
const BAD_BORDER = 'border-[rgba(176,58,46,0.55)] focus:border-[#8F2E24]';

const DANGER = '#8F2E24';

type Values = Record<string, string>;

const EMPTY: Values = { name: '', email: '', company: '', teamSize: '', brief: '' };

/**
 * The demo request.
 *
 * A client component because the form has three states a server-rendered page
 * cannot express: in flight, refused with the typed values still in the boxes,
 * and accepted. The page around it stays a server component, so the marketing
 * site ships one interactive island rather than becoming one.
 *
 * ## Why the inputs are controlled
 *
 * React resets an uncontrolled form after a `<form action={…}>` submission
 * completes — including a submission the server refused. Left uncontrolled,
 * somebody who wrote four sentences about their month-end and mistyped their
 * email address got the error *and* an empty form, which is a worse outcome
 * than the unwired form this replaced: that one at least only lost the answers
 * when it reloaded the page.
 *
 * Holding the values in state survives that reset, and it is why an end-to-end
 * spec asserts on the contents of the textarea after a refusal rather than
 * only on the error message.
 *
 * ## Why success replaces the form
 *
 * Leaving the fields on screen after a successful submission invites the
 * second click that produces the duplicate lead. Replacing them says the thing
 * was done, and is the only honest way to answer "did that work" — a green
 * message above a form that still looks submittable does not.
 */
export function ContactForm(): React.JSX.Element {
  const [state, action, pending] = useActionState(submitDemoRequest, IDLE);
  const [values, setValues] = useState<Values>(EMPTY);

  const fieldError = (name: string): string | undefined => state.fields?.[name]?.[0];

  const set = (name: string) => (event: { target: { value: string } }) => {
    setValues((current) => ({ ...current, [name]: event.target.value }));
  };

  if (state.status === 'success') {
    return (
      <div
        className="bg-white p-6 md:p-8"
        style={{ border: `1px solid ${LINE}` }}
        role="status"
        aria-live="polite"
      >
        <p className={`${EYEBROW} mb-3`}>Request received</p>
        <p className="m-0 text-[17px] leading-[1.55]" style={{ color: COLOR.ink }}>
          {state.message}
        </p>
        <p className="mt-4 mb-0 text-[14.5px] leading-[1.6]" style={{ color: COLOR.body }}>
          If it is urgent, <span style={{ color: COLOR.ink }}>sales@financy.app</span> reaches the
          same people directly.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-white p-6 md:p-8" style={{ border: `1px solid ${LINE}` }}>
      {/*
        `noValidate` so the browser's own bubble does not pre-empt the server's
        answer. The two disagree about what a valid address is, and a visitor
        should not have to satisfy one validator to find out what the other
        thinks.
      */}
      <form action={action} className="grid gap-[18px]" noValidate>
        {/*
          `role="alert"` so the refusal is announced rather than only drawn. A
          screen-reader user who submits and hears nothing has no way to tell a
          rejection from a slow network.
        */}
        {state.status === 'error' && state.message !== undefined ? (
          <p
            role="alert"
            className="m-0 rounded px-3 py-[11px] text-[14.5px] leading-[1.5]"
            style={{
              border: '1px solid rgba(176,58,46,0.28)',
              background: 'rgba(176,58,46,0.06)',
              color: DANGER,
            }}
          >
            {state.message}
          </p>
        ) : null}

        {CONTACT_FIELDS.map((field) => {
          const error = fieldError(field.name);
          const describedBy = error === undefined ? undefined : `${field.name}-error`;

          return (
            <div key={field.name}>
              <label htmlFor={field.name} className={`${EYEBROW} mb-2 block tracking-[0.1em]`}>
                {field.label}
              </label>
              <input
                id={field.name}
                name={field.name}
                type={field.type}
                autoComplete={field.autoComplete}
                placeholder={field.placeholder}
                maxLength={field.maxLength}
                required={field.required}
                value={values[field.name] ?? ''}
                onChange={set(field.name)}
                aria-invalid={error === undefined ? undefined : true}
                aria-describedby={describedBy}
                className={`${INPUT} ${error === undefined ? OK_BORDER : BAD_BORDER}`}
              />
              {error === undefined ? null : (
                <p id={describedBy} className="mt-1.5 mb-0 text-[13px]" style={{ color: DANGER }}>
                  {error}
                </p>
              )}
            </div>
          );
        })}

        <div>
          <label htmlFor="brief" className={`${EYEBROW} mb-2 block tracking-[0.1em]`}>
            What are you trying to fix?
          </label>
          <textarea
            id="brief"
            name="brief"
            rows={4}
            maxLength={4000}
            placeholder="Receipts, approvals, closing the month…"
            value={values['brief'] ?? ''}
            onChange={set('brief')}
            aria-invalid={fieldError('brief') === undefined ? undefined : true}
            aria-describedby={fieldError('brief') === undefined ? undefined : 'brief-error'}
            className={`${INPUT} resize-y ${
              fieldError('brief') === undefined ? OK_BORDER : BAD_BORDER
            }`}
          />
          {fieldError('brief') === undefined ? null : (
            <p id="brief-error" className="mt-1.5 mb-0 text-[13px]" style={{ color: DANGER }}>
              {fieldError('brief')}
            </p>
          )}
        </div>

        {/*
          `disabled` while in flight, and the label changes with it. Without
          both, the second click during a slow round trip sends a second
          request — which the API deduplicates, but the person cannot see that
          and has no reason to trust it.
        */}
        <button
          type="submit"
          disabled={pending}
          className="mt-1 w-full rounded-md bg-[#2B39C4] py-[13px] text-[14.5px] font-semibold text-white transition-colors hover:bg-[#1F2BA3] disabled:cursor-not-allowed disabled:bg-[#8D95DD]"
        >
          {pending ? 'Sending…' : 'Request a demo'}
        </button>
      </form>
    </div>
  );
}

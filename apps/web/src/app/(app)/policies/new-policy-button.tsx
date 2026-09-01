'use client';

import { useActionState, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { SPEND_TYPE_LABELS } from '@financy/contracts';
import { SPEND_TYPES } from '@financy/core';
import { Button, Dialog, FormMessage, Input, Textarea } from '@financy/ui';

import { IDLE } from '@/lib/form-state';
import { createPolicy } from './actions';

/**
 * Create a policy.
 *
 * The dialog asks for four things and no rules. A policy is created empty and
 * as a draft, because the rule builder is a screen rather than a field — and
 * because a policy that could be created already live, with rules nobody has
 * simulated, is a policy that starts deciding spend before anyone has read it.
 *
 * On success it **navigates to the new policy** instead of closing back to the
 * list. What was created is empty and useless until it has rules; returning
 * the author to a table where they then have to find the row they made a
 * second ago is a step that exists only because the code was easier that way.
 *
 * The spend-type checkboxes have no default, deliberately. A policy that
 * applied to everything by omission is the one that blocks an organisation's
 * entire spend the day it is published.
 */
export function NewPolicyButton(): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(createPolicy, IDLE);
  const router = useRouter();

  useEffect(() => {
    if (state.status === 'success' && state.createdId !== undefined) {
      setOpen(false);
      router.push(`/policies/${state.createdId}`);
    }
  }, [state, router]);

  return (
    <>
      <Button variant="primary" onClick={() => setOpen(true)}>
        New policy
      </Button>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="New policy"
        description="Created as a draft. It decides nothing until you add rules and publish it."
      >
        <form action={action} className="flex flex-col gap-4">
          {state.status === 'error' && state.message !== undefined && (
            <FormMessage>{state.message}</FormMessage>
          )}

          <Input
            name="name"
            label="Name"
            required
            maxLength={200}
            placeholder="Travel and entertainment"
            error={state.fields?.['name']?.[0]}
          />

          <Textarea
            name="description"
            label="What this policy is for"
            rows={2}
            maxLength={1000}
            placeholder="Why it exists, and who asked for it."
            error={state.fields?.['description']?.[0]}
          />

          <fieldset className="flex flex-col gap-2">
            <legend className="text-[13px] font-medium text-ink-700">Applies to</legend>
            <div className="grid grid-cols-2 gap-1.5">
              {SPEND_TYPES.map((type) => (
                <label key={type} className="flex items-center gap-2 text-[13px] text-ink-700">
                  <input
                    type="checkbox"
                    name="spendTypes"
                    value={type}
                    className="size-3.5 rounded border-[var(--border-strong)] accent-[var(--color-cobalt-600,#2563eb)]"
                  />
                  {SPEND_TYPE_LABELS[type] ?? type}
                </label>
              ))}
            </div>
            {state.fields?.['spendTypes']?.[0] !== undefined && (
              <p className="text-[13px] text-[var(--color-danger-text)]">
                {state.fields['spendTypes'][0]}
              </p>
            )}
          </fieldset>

          <Input
            name="priority"
            label="Priority"
            type="number"
            min={0}
            max={1000}
            defaultValue={100}
            hint="Higher runs first. A rule marked terminal stops everything below it."
            error={state.fields?.['priority']?.[0]}
          />

          <div className="mt-1 flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={pending}>
              Create draft
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}

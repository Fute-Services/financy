'use client';

import { useActionState } from 'react';
import type { OrganizationSettings } from '@financy/contracts';
import { Button, FormMessage, Input, Select } from '@financy/ui';

import { IDLE } from '@/lib/form-state';
import { updateOrganization } from './actions';

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
].map((label, index) => ({ value: String(index + 1), label }));

/**
 * The organisation form.
 *
 * Three things here are not obvious and all three are deliberate.
 *
 * **The version travels in a hidden input.** It was rendered with the page, so
 * it is the version the person actually looked at — which is exactly what
 * `If-Match` is supposed to assert. Reading it fresh at submit time would
 * defeat the precondition by construction: the save would always match, and a
 * colleague's concurrent edit would always be lost.
 *
 * **A conflict offers a reload, not a retry.** Retrying with the same stale
 * version fails identically, and the person needs to see what changed before
 * deciding whether they still want their edit.
 *
 * **The slug is shown and not editable, with the reason next to it.** A
 * greyed-out box with no explanation is indistinguishable from a broken one.
 */
export function OrganizationForm({
  organization,
  canEdit,
}: {
  organization: OrganizationSettings['organization'];
  canEdit: boolean;
}): React.JSX.Element {
  const [state, action, pending] = useActionState(updateOrganization, IDLE);

  const field = (name: string): string | undefined => state.fields?.[name]?.[0];

  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="version" value={organization.version} />

      {state.status === 'error' && state.message !== undefined ? (
        <FormMessage>
          {state.message}
          {state.conflict === true ? (
            <>
              {' '}
              <button
                type="button"
                onClick={() => {
                  window.location.reload();
                }}
                className="underline underline-offset-2"
              >
                Reload
              </button>
            </>
          ) : null}
        </FormMessage>
      ) : null}

      {state.status === 'success' && state.message !== undefined ? (
        <FormMessage tone="success">{state.message}</FormMessage>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <Input
          name="name"
          label="Name"
          defaultValue={organization.name}
          required
          disabled={!canEdit}
          error={field('name')}
          maxLength={200}
        />

        <Input
          name="legalName"
          label="Legal name"
          defaultValue={organization.legalName ?? ''}
          disabled={!canEdit}
          error={field('legalName')}
          hint="Leave blank if it is the same as the name above."
          maxLength={200}
        />

        <Input
          name="slug"
          label="Slug"
          defaultValue={organization.slug}
          disabled
          hint="Fixed. It appears in links people have saved, so renaming it would break them."
        />

        <Input
          name="baseCurrency"
          label="Base currency"
          defaultValue={organization.baseCurrency}
          disabled
          hint={
            organization.baseCurrencyLocked
              ? 'Locked: financial records exist in this currency.'
              : 'Set at registration. Changing it is a separate, audited operation.'
          }
        />

        <Input
          name="countryCode"
          label="Country"
          defaultValue={organization.countryCode}
          disabled={!canEdit}
          error={field('countryCode')}
          maxLength={2}
          className="uppercase"
          hint="Two-letter ISO 3166 code."
        />

        <Input
          name="timezone"
          label="Timezone"
          defaultValue={organization.timezone}
          disabled={!canEdit}
          error={field('timezone')}
          hint="An IANA name, such as Europe/London."
        />

        <Select
          name="fiscalYearStartMonth"
          label="Fiscal year starts"
          options={MONTHS}
          defaultValue={String(organization.fiscalYearStartMonth)}
          disabled={!canEdit}
          error={field('fiscalYearStartMonth')}
        />
      </div>

      {canEdit ? (
        <div className="flex justify-end">
          <Button type="submit" variant="primary" loading={pending}>
            Save changes
          </Button>
        </div>
      ) : null}
    </form>
  );
}

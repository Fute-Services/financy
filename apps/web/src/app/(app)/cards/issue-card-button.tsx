'use client';

import { useActionState, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  CARD_TYPES,
  CARD_TYPE_LABELS,
  LIMIT_PERIODS,
  LIMIT_PERIOD_LABELS,
  type CategoryNode,
  type DepartmentNode,
  type EntitySummary,
  type Person,
} from '@financy/contracts';
import { Button, Dialog, FormMessage, Input, Select } from '@financy/ui';

import { IDLE } from '@/lib/form-state';
import { issueCard } from './actions';

/**
 * Issue a card.
 *
 * **The limit and its period are both required, and neither has a default that
 * hides the question.** A card issued without a limit is an unlimited card, and
 * "we will set it later" is how one stays unlimited; an amount without a period
 * is a number nobody can enforce. The two controls sit side by side so the
 * sentence reads — "€2,000 per month" — rather than being assembled from
 * fields on opposite sides of a form.
 *
 * On success it navigates to the card, because what was just created is what
 * the person now wants to look at.
 */
export function IssueCardButton({
  entities,
  departments,
  categories,
  people,
  baseCurrency,
}: {
  entities: readonly EntitySummary[];
  departments: readonly DepartmentNode[];
  categories: readonly CategoryNode[];
  people: readonly Person[];
  baseCurrency: string;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(issueCard, IDLE);
  const router = useRouter();

  useEffect(() => {
    if (state.status === 'success' && state.createdId !== undefined) {
      setOpen(false);
      router.push(`/cards/${state.createdId}`);
    }
  }, [state, router]);

  const activeEntities = entities.filter((entity) => entity.status === 'ACTIVE');

  return (
    <>
      <Button variant="primary" onClick={() => setOpen(true)}>
        Issue card
      </Button>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Issue a card"
        description="A spending authorisation for one person, with a limit that resets on a period you choose."
      >
        <form action={action} className="flex flex-col gap-4">
          {state.status === 'error' && state.message !== undefined && (
            <FormMessage>{state.message}</FormMessage>
          )}

          <Input
            name="name"
            label="What to call it"
            required
            maxLength={100}
            placeholder="Marketing — ad spend"
            hint="People recognise cards by name, not by number."
            error={state.fields?.['name']?.[0]}
          />

          <div className="grid gap-4 sm:grid-cols-2">
            <Select
              name="cardType"
              label="Kind"
              options={CARD_TYPES.map((type) => ({
                value: type,
                label: CARD_TYPE_LABELS[type],
              }))}
              defaultValue="VIRTUAL"
              error={state.fields?.['cardType']?.[0]}
            />

            <Select
              name="entityId"
              label="Entity"
              required
              options={activeEntities.map((entity) => ({
                value: entity.id,
                label: entity.name,
              }))}
              defaultValue={activeEntities[0]?.id ?? ''}
              error={state.fields?.['entityId']?.[0]}
            />
          </div>

          {people.length > 0 ? (
            <Select
              name="holderMembershipId"
              label="Who holds it"
              required
              options={people.map((person) => ({
                value: person.id,
                label: `${person.fullName} · ${person.email}`,
              }))}
              placeholder="Choose a person"
              defaultValue=""
              error={state.fields?.['holderMembershipId']?.[0]}
            />
          ) : (
            <Input
              name="holderMembershipId"
              label="Membership id of the holder"
              required
              hint="You cannot read the member list, so the id has to be typed."
              className="font-mono text-[13px]"
              error={state.fields?.['holderMembershipId']?.[0]}
            />
          )}

          <div className="grid grid-cols-[1fr_90px_150px] gap-3">
            <Input
              name="limitAmount"
              label="Limit"
              required
              inputMode="decimal"
              placeholder="2000.00"
              className="tabular text-right"
              error={state.fields?.['limit']?.[0]}
            />
            <Input
              name="limitCurrency"
              label="Currency"
              required
              defaultValue={baseCurrency}
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
              defaultValue="MONTHLY"
              error={state.fields?.['limitPeriod']?.[0]}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Select
              name="departmentId"
              label="Department"
              options={[
                { value: '', label: 'None' },
                ...departments.map((department) => ({
                  value: department.id,
                  label: `${'— '.repeat(department.depth)}${department.name}`,
                })),
              ]}
              defaultValue=""
              hint="Charges inherit it, so reports need no re-coding."
              error={state.fields?.['departmentId']?.[0]}
            />

            <Select
              name="categoryId"
              label="Default category"
              options={[
                { value: '', label: 'None' },
                ...categories.map((category) => ({
                  value: category.id,
                  label: `${'— '.repeat(category.depth)}${category.name}`,
                })),
              ]}
              defaultValue=""
              error={state.fields?.['categoryId']?.[0]}
            />
          </div>

          <div className="mt-1 flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={pending}>
              Issue card
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}

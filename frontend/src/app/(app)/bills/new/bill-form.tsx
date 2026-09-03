'use client';

import { useActionState, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { EntitySummary, VendorRecord } from '@financy/contracts';
import { Button, Card, CardBody, CardHeader, FormMessage, Input, Select, Textarea } from '@financy/ui';

import { IDLE } from '@/lib/form-state';
import { createBill } from '../actions';

/**
 * Entering an invoice.
 *
 * ## Lines, always — even for a one-line invoice
 *
 * A bill's total is the sum of its lines and there is no box for a total. That
 * is not tidiness: an invoice whose stated total disagrees with its own lines
 * is a number somebody pays and then argues about for a week, and the only way
 * to make that impossible is to not offer the box.
 *
 * ## The due date is left blank on purpose
 *
 * Absent means "use the supplier's payment terms", which is right for almost
 * every invoice and is computed on the server from the terms already on record.
 * Pre-filling it here would put a date in front of somebody that looks like a
 * decision they made.
 */
export function BillForm({
  vendors,
  entities,
  baseCurrency,
}: {
  vendors: readonly VendorRecord[];
  entities: readonly EntitySummary[];
  baseCurrency: string;
}): React.JSX.Element {
  const router = useRouter();
  const [state, submit, pending] = useActionState(createBill, IDLE);
  const [lines, setLines] = useState([{ key: 0 }]);
  const [nextKey, setNextKey] = useState(1);

  useEffect(() => {
    if (state.status === 'success' && state.createdId !== undefined) {
      router.push(`/bills/${state.createdId}`);
    }
  }, [state, router]);

  const today = new Date().toISOString().slice(0, 10);

  return (
    <form action={submit} className="flex flex-col gap-4">
      <Card>
        <CardHeader title="The invoice" />
        <CardBody className="grid gap-4 sm:grid-cols-2">
          <Select
            name="vendorId"
            label="Supplier"
            required
            options={vendors.map((vendor) => ({ value: vendor.id, label: vendor.name }))}
            hint={
              vendors.length === 0
                ? 'There are no active suppliers yet. Add one first.'
                : undefined
            }
          />
          <Input
            name="billNumber"
            label="Their invoice number"
            required
            maxLength={100}
            hint="Theirs, not ours. Unique per supplier."
          />

          <Select
            name="entityId"
            label="Which entity pays"
            required
            options={entities.map((entity) => ({ value: entity.id, label: entity.name }))}
          />
          <Input
            name="currency"
            label="Currency"
            defaultValue={baseCurrency}
            maxLength={3}
            required
          />

          <Input name="issueDate" label="Issued" type="date" defaultValue={today} required />
          <Input
            name="dueDate"
            label="Due"
            type="date"
            hint="Leave blank to use the supplier's payment terms."
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Lines"
          description="The total is the sum of these, computed on the server. There is no box for a total, and that is deliberate."
          action={
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                setLines([...lines, { key: nextKey }]);
                setNextKey(nextKey + 1);
              }}
            >
              Add a line
            </Button>
          }
        />
        <CardBody className="flex flex-col gap-2">
          {lines.map((line, index) => (
            <div key={line.key} className="flex items-end gap-2">
              <input
                name="lineDescription"
                aria-label={`Line ${String(index + 1)} description`}
                placeholder="What it is for"
                className="h-8 flex-1 rounded-[var(--radius-sm)] border border-line px-2 text-[13px]"
              />
              <input
                name="lineQuantity"
                aria-label={`Line ${String(index + 1)} quantity`}
                defaultValue="1"
                inputMode="decimal"
                className="tabular h-8 w-20 rounded-[var(--radius-sm)] border border-line px-2 text-right text-[13px]"
              />
              <input
                name="lineUnitAmount"
                aria-label={`Line ${String(index + 1)} unit amount`}
                placeholder="0.00"
                inputMode="decimal"
                className="tabular h-8 w-28 rounded-[var(--radius-sm)] border border-line px-2 text-right text-[13px]"
              />
              <Button
                type="button"
                size="sm"
                variant="ghost"
                aria-label={`Remove line ${String(index + 1)}`}
                disabled={lines.length === 1}
                onClick={() => setLines(lines.filter((_, position) => position !== index))}
              >
                Remove
              </Button>
            </div>
          ))}
        </CardBody>
      </Card>

      <Card>
        <CardBody className="flex flex-col gap-3">
          <Textarea name="memo" label="Anything an approver should know" rows={2} maxLength={2000} />

          {state.status === 'error' && state.message !== undefined && (
            <FormMessage>{state.message}</FormMessage>
          )}

          <div className="flex items-center justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => router.push('/bills')}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={pending}>
              Save as a draft
            </Button>
          </div>
        </CardBody>
      </Card>
    </form>
  );
}

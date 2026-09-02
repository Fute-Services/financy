'use client';

import { useActionState, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { EntitySummary, VendorRecord } from '@financy/contracts';
import { Button, Card, CardBody, CardHeader, FormMessage, Input, Select, Textarea } from '@financy/ui';

import { IDLE } from '@/lib/form-state';
import { createOrder } from '../actions';

/**
 * Raising a purchase order.
 *
 * **Quantity is required on every line, and that is the whole difference
 * between this and a spend request.** A receipt against this order later has to
 * be able to say six of the ten arrived; an order that recorded only a total
 * makes partial delivery unrepresentable, and three-way matching impossible.
 */
export function OrderForm({
  vendors,
  entities,
  baseCurrency,
}: {
  vendors: readonly VendorRecord[];
  entities: readonly EntitySummary[];
  baseCurrency: string;
}): React.JSX.Element {
  const router = useRouter();
  const [state, submit, pending] = useActionState(createOrder, IDLE);
  const [lines, setLines] = useState([{ key: 0 }]);
  const [nextKey, setNextKey] = useState(1);

  useEffect(() => {
    if (state.status === 'success' && state.createdId !== undefined) {
      router.push(`/procurement/${state.createdId}`);
    }
  }, [state, router]);

  return (
    <form action={submit} className="flex flex-col gap-4">
      <Card>
        <CardHeader title="Who and what" />
        <CardBody className="grid gap-4 sm:grid-cols-2">
          <Select
            name="vendorId"
            label="Supplier"
            required
            options={vendors.map((vendor) => ({ value: vendor.id, label: vendor.name }))}
            hint={
              vendors.length === 0 ? 'There are no active suppliers yet. Add one first.' : undefined
            }
          />
          <Select
            name="entityId"
            label="Which entity buys"
            required
            options={entities.map((entity) => ({ value: entity.id, label: entity.name }))}
          />

          <Input name="currency" label="Currency" defaultValue={baseCurrency} maxLength={3} required />
          <Input
            name="expectedDate"
            label="Expected"
            type="date"
            hint="When the supplier says it will arrive."
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Lines"
          description="Quantities matter here — a delivery is recorded against them."
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
                placeholder="What is being bought"
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
                aria-label={`Line ${String(index + 1)} unit price`}
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
          <Textarea name="memo" label="Why this is needed" rows={2} maxLength={2000} />

          {state.status === 'error' && state.message !== undefined && (
            <FormMessage>{state.message}</FormMessage>
          )}

          <div className="flex items-center justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => router.push('/procurement')}>
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

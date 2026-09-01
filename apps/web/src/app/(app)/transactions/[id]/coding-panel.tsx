'use client';

import { useActionState } from 'react';
import type { CategoryNode, DepartmentNode, TransactionDetail } from '@financy/contracts';
import { Button, Card, CardBody, CardHeader, FormMessage, Select, Textarea } from '@financy/ui';

import { IDLE } from '@/lib/form-state';
import { categorizeTransaction } from '../actions';

/**
 * Coding a charge after it happened.
 *
 * **Editable on a posted transaction, and that is not an inconsistency.** The
 * immutability rule is written in terms of specific columns — amount, currency,
 * merchant, date — because those are the money, and somebody has reconciled
 * against them. A category is *about* the money and is decided afterwards by a
 * human; a posted transaction that could never be categorised would make the
 * finance review queue impossible.
 *
 * The form saves in place rather than in a dialog. Coding is the repetitive
 * part of finance work, and a modal per charge is a modal opened four hundred
 * times a month.
 */
export function CodingPanel({
  transaction,
  departments,
  categories,
}: {
  transaction: TransactionDetail;
  departments: readonly DepartmentNode[];
  categories: readonly CategoryNode[];
}): React.JSX.Element {
  const [state, action, pending] = useActionState(categorizeTransaction, IDLE);

  return (
    <Card>
      <CardHeader
        title="Coding"
        description="What this charge was for. Editable after settlement — the amount is not."
      />

      <CardBody>
        <form action={action} className="flex flex-col gap-4">
          <input type="hidden" name="id" value={transaction.id} />
          <input type="hidden" name="version" value={transaction.version} />

          {state.status === 'error' && state.message !== undefined && (
            <FormMessage>{state.message}</FormMessage>
          )}
          {state.status === 'success' && state.message !== undefined && (
            <FormMessage tone="success">{state.message}</FormMessage>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <Select
              name="categoryId"
              label="Category"
              options={[
                { value: '', label: 'Not coded' },
                ...categories.map((category) => ({
                  value: category.id,
                  label: `${'— '.repeat(category.depth)}${category.name}`,
                })),
              ]}
              defaultValue={transaction.categoryId ?? ''}
              hint="Setting one marks the charge coded for the accounting export."
              error={state.fields?.['categoryId']?.[0]}
            />

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
              defaultValue={transaction.departmentId ?? ''}
              error={state.fields?.['departmentId']?.[0]}
            />
          </div>

          <Textarea
            name="memo"
            label="Memo"
            rows={2}
            maxLength={2000}
            defaultValue={transaction.memo ?? ''}
            placeholder="What this was for, if the merchant name does not say."
            error={state.fields?.['memo']?.[0]}
          />

          <div className="flex justify-end">
            <Button type="submit" variant="primary" loading={pending}>
              Save coding
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}

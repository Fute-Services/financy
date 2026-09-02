'use client';

import { useActionState, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  EXPENSE_PAYMENT_METHODS,
  EXPENSE_PAYMENT_METHOD_LABELS,
  RECEIPT_CONTENT_TYPES,
  RECEIPT_MAX_BYTES,
  type CategoryNode,
  type DepartmentNode,
  type EntitySummary,
} from '@financy/contracts';
import { Button, Card, CardBody, CardHeader, FormMessage, Input, Select, Textarea } from '@financy/ui';

import { IDLE } from '@/lib/form-state';
import { completeReceiptUpload, createAndSubmitExpense, requestReceiptUpload } from '../actions';

/**
 * Raising a claim, receipt first.
 *
 * ## The receipt is picked before anything is typed
 *
 * That is the order people actually work in: the photograph exists before the
 * claim does. It also means the evidence is attached before submission, which
 * matters because policy can require one — a form that uploaded afterwards
 * would block on submit and ask the person to do the thing they had already
 * done.
 *
 * ## The file goes straight to storage
 *
 * The browser asks for an intent, PUTs the bytes to the signed URL, and tells
 * the server it is done. Nothing large passes through the Next server, and the
 * upload's progress is the browser's own.
 *
 * ## Items are optional and the total follows them
 *
 * Most claims are one thing. When there are lines, the amount box disappears:
 * showing both would invite somebody to type a total that disagrees with its
 * own items, which the server refuses and neither of them can resolve.
 */
export function ExpenseForm({
  entities,
  departments,
  categories,
  baseCurrency,
}: {
  entities: readonly EntitySummary[];
  departments: readonly DepartmentNode[];
  categories: readonly CategoryNode[];
  baseCurrency: string;
}): React.JSX.Element {
  const router = useRouter();
  const [state, submit, pending] = useActionState(createAndSubmitExpense, IDLE);
  const [items, setItems] = useState<{ description: string; amount: string }[]>([]);
  const [receipt, setReceipt] = useState<{ id: string; name: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  async function upload(file: File): Promise<void> {
    setUploadError(null);

    if (file.size > RECEIPT_MAX_BYTES) {
      setUploadError(`That file is larger than ${String(RECEIPT_MAX_BYTES / 1024 / 1024)} MB.`);
      return;
    }

    if (!RECEIPT_CONTENT_TYPES.includes(file.type as (typeof RECEIPT_CONTENT_TYPES)[number])) {
      // Checked here for a fast answer and checked again on the server from the
      // file's own bytes, which is the check that counts.
      setUploadError('Receipts can be a PDF, JPEG, PNG, HEIC, or WebP.');
      return;
    }

    setUploading(true);

    try {
      const intent = await requestReceiptUpload({
        fileName: file.name,
        contentType: file.type,
        byteSize: file.size,
      });

      const response = await fetch(intent.uploadUrl, { method: 'PUT', body: file });

      if (!response.ok) throw new Error('The upload was refused.');

      // Attached after the draft exists, so this only completes the upload; the
      // attachment happens when the claim is created.
      await completeReceiptUpload(intent.receiptId, null);

      setReceipt({ id: intent.receiptId, name: file.name });
    } catch {
      setUploadError('That upload did not finish. Try again.');
    } finally {
      setUploading(false);
    }
  }

  const today = new Date().toISOString().slice(0, 10);

  return (
    <form action={submit} className="flex flex-col gap-4">
      <input type="hidden" name="currency" value={baseCurrency} />
      {receipt !== null && <input type="hidden" name="receiptId" value={receipt.id} />}

      <Card>
        <CardHeader
          title="The receipt"
          description="Pick it first — it is what policy asks for, and it is usually already on your phone."
        />
        <CardBody className="flex flex-col gap-3">
          <input
            ref={fileInput}
            type="file"
            accept={RECEIPT_CONTENT_TYPES.join(',')}
            aria-label="Receipt file"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file !== undefined) void upload(file);
            }}
            className="text-[13px] text-ink-700 file:mr-3 file:h-8 file:rounded-[var(--radius-sm)] file:border-0 file:bg-ink-100 file:px-3 file:text-[13px]"
          />

          {uploading && <p className="text-[13px] text-ink-500">Uploading…</p>}
          {receipt !== null && (
            <p className="text-[13px] text-[var(--color-success-text)]">
              Attached: {receipt.name}
            </p>
          )}
          {uploadError !== null && <FormMessage>{uploadError}</FormMessage>}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="What was it" />
        <CardBody className="grid gap-4 sm:grid-cols-2">
          <Input name="merchantName" label="Merchant" required maxLength={200} />
          <Input name="expenseDate" label="When" type="date" defaultValue={today} required />

          {items.length === 0 && (
            <Input
              name="amount"
              label="Amount"
              inputMode="decimal"
              placeholder="0.00"
              required
              hint={`In ${baseCurrency}.`}
            />
          )}

          <Select
            name="paymentMethod"
            label="How it was paid"
            defaultValue="OUT_OF_POCKET"
            options={EXPENSE_PAYMENT_METHODS.map((method) => ({
              value: method,
              label: EXPENSE_PAYMENT_METHOD_LABELS[method],
            }))}
          />

          <Select
            name="entityId"
            label="Entity"
            required
            options={entities.map((entity) => ({ value: entity.id, label: entity.name }))}
          />

          <Select
            name="categoryId"
            label="Category"
            placeholder="Uncategorised"
            options={categories.map((category) => ({ value: category.id, label: category.name }))}
          />

          <Select
            name="departmentId"
            label="Department"
            placeholder="None"
            options={departments.map((department) => ({
              value: department.id,
              label: department.name,
            }))}
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Items"
          description="Optional. Add them when one claim covers several things — a trip, a week of meals."
          action={
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setItems([...items, { description: '', amount: '' }])}
            >
              Add an item
            </Button>
          }
        />
        {items.length > 0 && (
          <CardBody className="flex flex-col gap-2">
            {items.map((item, index) => (
              <div key={index} className="flex items-end gap-2">
                <input
                  name="itemDescription"
                  aria-label={`Item ${String(index + 1)} description`}
                  defaultValue={item.description}
                  className="h-8 flex-1 rounded-[var(--radius-sm)] border border-line px-2 text-[13px]"
                />
                <input
                  name="itemAmount"
                  aria-label={`Item ${String(index + 1)} amount`}
                  defaultValue={item.amount}
                  inputMode="decimal"
                  placeholder="0.00"
                  className="tabular h-8 w-28 rounded-[var(--radius-sm)] border border-line px-2 text-right text-[13px]"
                />
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  aria-label={`Remove item ${String(index + 1)}`}
                  onClick={() => setItems(items.filter((_, position) => position !== index))}
                >
                  Remove
                </Button>
              </div>
            ))}
            <p className="text-[12px] text-ink-500">
              The total is the sum of these, computed on the server.
            </p>
          </CardBody>
        )}
      </Card>

      <Card>
        <CardBody className="flex flex-col gap-3">
          <Textarea
            name="memo"
            label="Anything an approver should know"
            rows={3}
            maxLength={2000}
            error={state.fields?.['memo']?.[0]}
          />

          {state.status === 'error' && state.message !== undefined && (
            <FormMessage>{state.message}</FormMessage>
          )}

          <div className="flex items-center justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => router.push('/expenses')}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={pending}>
              Submit
            </Button>
          </div>
        </CardBody>
      </Card>
    </form>
  );
}

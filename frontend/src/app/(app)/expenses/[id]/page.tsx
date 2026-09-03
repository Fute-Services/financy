import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  EXPENSE_PAYMENT_METHOD_LABELS,
  EXPENSE_STATUS_LABELS,
  type ApprovalInstance,
  type ExpenseRecord,
  type ReceiptDetail,
  type Resource,
} from '@financy/contracts';
import { Card, CardBody, CardHeader, Money, PermissionState, StatusBadge } from '@financy/ui';

import { ApprovalTimeline } from '@/components/approval-timeline';
import { DecisionPanel } from '@/components/decision-panel';
import { PageHeader } from '@/components/page-header';
import { ApiError, apiFetch } from '@/lib/api';
import { can, getSession } from '@/lib/session';
import { ExpenseActions } from './expense-actions';

export const metadata: Metadata = { title: 'Expense' };

/**
 * One claim, with its evidence and its decision.
 *
 * The receipt is shown as a link rather than an embedded preview, and the link
 * is minted per render: a download URL that lived on the page would outlive the
 * permission check that produced it.
 */
export default async function ExpensePage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<React.JSX.Element> {
  const session = await getSession();
  const { id } = await params;

  if (session === null || !can(session, 'expense:read')) {
    return (
      <>
        <PageHeader title="Expense" />
        <Card>
          <PermissionState permission="expense:read" />
        </Card>
      </>
    );
  }

  let expense: ExpenseRecord;

  try {
    expense = (await apiFetch<Resource<ExpenseRecord>>(`/expenses/${id}`)).data;
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }

  const [instance, receipts] = await Promise.all([
    expense.approvalInstanceId === null
      ? Promise.resolve(null)
      : apiFetch<Resource<ApprovalInstance>>(`/approvals/${expense.approvalInstanceId}`)
          .then((response) => response.data)
          .catch(() => null),
    Promise.all(
      expense.receiptIds.map((receiptId) =>
        apiFetch<Resource<ReceiptDetail>>(`/receipts/${receiptId}`)
          .then((response) => response.data)
          .catch(() => null),
      ),
    ),
  ]);

  return (
    <>
      <div className="mb-1">
        <Link href="/expenses" className="text-[13px] text-ink-500 hover:text-cobalt-600">
          ← Expenses
        </Link>
      </div>

      <PageHeader
        title={expense.merchantName}
        description={`${expense.reference} · ${EXPENSE_PAYMENT_METHOD_LABELS[expense.paymentMethod]}`}
        action={
          <StatusBadge status={expense.status} label={EXPENSE_STATUS_LABELS[expense.status]} />
        }
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-4">
          <Card>
            <CardHeader title="The claim" />
            <CardBody className="grid gap-3 sm:grid-cols-2">
              <Field label="Amount">
                <Money amount={expense.amount.amount} currency={expense.amount.currency} />
              </Field>
              <Field label="Spent on">{formatDate(expense.expenseDate)}</Field>
              <Field label="Claimed by">{expense.submitter.fullName}</Field>
              <Field label="Submitted">
                {expense.submittedAt === null ? 'Not yet' : formatDate(expense.submittedAt)}
              </Field>
              {expense.memo !== null && (
                <div className="sm:col-span-2">
                  <Field label="Note">{expense.memo}</Field>
                </div>
              )}
            </CardBody>
          </Card>

          {expense.items.length > 0 && (
            <Card>
              <CardHeader title="Items" description="The total is the sum of these." />
              <CardBody className="p-0">
                <ul className="divide-y divide-[var(--border-subtle)]">
                  {expense.items.map((item) => (
                    <li key={item.id} className="flex items-center justify-between px-5 py-2.5">
                      <span className="text-[13px] text-ink-700">{item.description}</span>
                      <Money amount={item.amount.amount} currency={item.amount.currency} />
                    </li>
                  ))}
                </ul>
              </CardBody>
            </Card>
          )}

          <Card>
            <CardHeader
              title="Evidence"
              description="Links are issued when this page loads and expire within fifteen minutes."
            />
            <CardBody>
              {receipts.filter((receipt) => receipt !== null).length === 0 ? (
                <p className="text-[13px] text-ink-500">
                  No receipt is attached. Policy may ask for one before this can be submitted.
                </p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {receipts.map((receipt) =>
                    receipt === null ? null : (
                      <li key={receipt.id} className="flex items-center justify-between gap-3">
                        <span className="truncate text-[13px] text-ink-700">
                          {receipt.fileName}
                        </span>
                        {receipt.downloadUrl === null ? (
                          <span className="text-[12px] text-ink-400">Not available</span>
                        ) : (
                          <a
                            href={receipt.downloadUrl}
                            className="text-[13px] text-[var(--color-accent-text)] hover:underline"
                          >
                            Download
                          </a>
                        )}
                      </li>
                    ),
                  )}
                </ul>
              )}
            </CardBody>
          </Card>

          {instance !== null && (
            <Card>
              <CardHeader
                title="Approval"
                description="Steps run in order. Approvers were resolved when the chain opened."
              />
              <CardBody>
                <ApprovalTimeline instance={instance} />
              </CardBody>
            </Card>
          )}
        </div>

        <div className="flex flex-col gap-4">
          <ExpenseActions expense={expense} />

          {expense.policyDecision !== null && expense.policyDecision !== undefined && (
            <DecisionPanel decision={expense.policyDecision as never} />
          )}
        </div>
      </div>
    </>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-ink-500">{label}</div>
      <div className="mt-0.5 text-[13px] text-ink-800">{children}</div>
    </div>
  );
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

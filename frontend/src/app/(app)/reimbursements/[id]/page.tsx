import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  REIMBURSEMENT_STATUS_LABELS,
  type ReimbursementDetail,
  type Resource,
} from '@financy/contracts';
import { Card, CardBody, CardHeader, Money, PermissionState, StatusBadge } from '@financy/ui';

import { PageHeader } from '@/components/page-header';
import { ApiError, apiFetch } from '@/lib/api';
import { can, getSession } from '@/lib/session';
import { BatchActions } from './batch-actions';

export const metadata: Metadata = { title: 'Reimbursement' };

/**
 * One batch, and every claim inside it.
 *
 * The lines are shown in full rather than summarised, because the moment before
 * releasing money is exactly when somebody wants to see what they are paying
 * for — and a total with no breakdown is a number people approve out of
 * politeness.
 */
export default async function ReimbursementPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<React.JSX.Element> {
  const session = await getSession();
  const { id } = await params;

  if (session === null || !can(session, 'reimbursement:read')) {
    return (
      <>
        <PageHeader title="Reimbursement" />
        <Card>
          <PermissionState permission="reimbursement:read" />
        </Card>
      </>
    );
  }

  let batch: ReimbursementDetail;

  try {
    batch = (await apiFetch<Resource<ReimbursementDetail>>(`/reimbursements/${id}`)).data;
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }

  return (
    <>
      <div className="mb-1">
        <Link href="/reimbursements" className="text-[13px] text-ink-500 hover:text-cobalt-600">
          ← Reimbursements
        </Link>
      </div>

      <PageHeader
        title={`${batch.reference} · ${batch.payee.fullName}`}
        description={`${formatDate(batch.periodStart)} – ${formatDate(batch.periodEnd)}`}
        action={
          <StatusBadge status={batch.status} label={REIMBURSEMENT_STATUS_LABELS[batch.status]} />
        }
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Card>
          <CardHeader
            title="What is being paid"
            description="Every approved out-of-pocket claim that matched. Nothing was added by hand."
          />
          <CardBody className="p-0">
            <ul className="divide-y divide-[var(--border-subtle)]">
              {batch.lines.map((line) => (
                <li key={line.id} className="flex items-center justify-between gap-3 px-5 py-2.5">
                  <div className="min-w-0">
                    <Link
                      href={`/expenses/${line.expenseId}`}
                      className="font-mono text-[12px] text-ink-500 hover:text-cobalt-600 hover:underline"
                    >
                      {line.reference}
                    </Link>
                    <div className="truncate text-[13px] text-ink-800">{line.merchantName}</div>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="text-[12px] text-ink-400">
                      {formatDate(line.expenseDate)}
                    </span>
                    <Money amount={line.amount.amount} currency={line.amount.currency} />
                  </div>
                </li>
              ))}
            </ul>

            <div className="flex items-center justify-between border-t border-[var(--border-default)] px-5 py-3">
              <span className="text-[13px] font-medium text-ink-800">
                {batch.lineCount} claim{batch.lineCount === 1 ? '' : 's'}
              </span>
              {/* Summed on the server from the lines above, never in the browser. */}
              <Money amount={batch.total.amount} currency={batch.total.currency} />
            </div>
          </CardBody>
        </Card>

        <BatchActions batch={batch} session={{ permissions: [...session.permissions] }} />
      </div>
    </>
  );
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

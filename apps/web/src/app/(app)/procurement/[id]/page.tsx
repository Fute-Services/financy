import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  PURCHASE_ORDER_STATUS_LABELS,
  type ApprovalInstance,
  type PurchaseOrderDetail,
  type Resource,
} from '@financy/contracts';
import {
  Card,
  CardBody,
  CardHeader,
  Money,
  PermissionState,
  StatusBadge,
} from '@financy/ui';

import { ApprovalTimeline } from '@/components/approval-timeline';
import { PageHeader } from '@/components/page-header';
import { ApiError, apiFetch } from '@/lib/api';
import { can, getSession } from '@/lib/session';
import { OrderActions } from './order-actions';
import { ReceivePanel } from './receive-panel';

export const metadata: Metadata = { title: 'Purchase order' };

/**
 * One purchase order.
 *
 * **Outstanding is the column that matters.** Ordered and received are both
 * facts; what somebody chases is the difference, and it arrives from the server
 * already computed — a browser subtracting two decimal strings is the
 * arithmetic this application exists to keep out of browsers.
 */
export default async function PurchaseOrderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<React.JSX.Element> {
  const session = await getSession();
  const { id } = await params;

  if (session === null || !can(session, 'purchase_order:read')) {
    return (
      <>
        <PageHeader title="Purchase order" />
        <Card>
          <PermissionState permission="purchase_order:read" />
        </Card>
      </>
    );
  }

  let order: PurchaseOrderDetail;

  try {
    order = (await apiFetch<Resource<PurchaseOrderDetail>>(`/purchase-orders/${id}`)).data;
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }

  const instance =
    order.approvalInstanceId === null
      ? null
      : await apiFetch<Resource<ApprovalInstance>>(`/approvals/${order.approvalInstanceId}`)
          .then((response) => response.data)
          .catch(() => null);

  const receivable =
    order.status === 'APPROVED' ||
    order.status === 'PARTIALLY_RECEIVED' ||
    order.status === 'RECEIVED';

  return (
    <>
      <div className="mb-1">
        <Link href="/procurement" className="text-[13px] text-ink-500 hover:text-cobalt-600">
          ← Procurement
        </Link>
      </div>

      <PageHeader
        title={order.vendor.name}
        description={`${order.poNumber} · raised by ${order.requester.fullName}`}
        action={
          <StatusBadge
            status={order.status}
            label={PURCHASE_ORDER_STATUS_LABELS[order.status]}
          />
        }
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-4">
          <Card>
            <CardHeader title="The order" />
            <CardBody className="grid gap-3 sm:grid-cols-2">
              <Field label="Value">
                <Money amount={order.total.amount} currency={order.total.currency} />
              </Field>
              <Field label="Expected">
                {order.expectedDate === null ? 'Not stated' : formatDay(order.expectedDate)}
              </Field>
              <Field label="Approved">
                {order.approvedAt === null ? 'Not yet' : formatDay(order.approvedAt)}
              </Field>
              <Field label="Raised">{formatDay(order.createdAt)}</Field>
              {order.memo !== null && (
                <div className="sm:col-span-2">
                  <Field label="Note">{order.memo}</Field>
                </div>
              )}
            </CardBody>
          </Card>

          <Card className="overflow-hidden">
            <CardHeader
              title="Lines"
              description="What was ordered, what has arrived, and what is still outstanding."
            />
            <CardBody className="p-0">
              <table className="w-full text-[13px]">
                <caption className="sr-only">Purchase order lines</caption>
                <thead>
                  <tr className="border-b border-[var(--border-subtle)] text-[11px] tracking-wide text-ink-500 uppercase">
                    <th scope="col" className="px-5 py-2 text-left font-medium">
                      What
                    </th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">
                      Ordered
                    </th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">
                      Received
                    </th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">
                      Outstanding
                    </th>
                    <th scope="col" className="px-5 py-2 text-right font-medium">
                      Value
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border-subtle)]">
                  {order.lines.map((line) => (
                    <tr key={line.id}>
                      <td className="px-5 py-2.5 text-ink-800">{line.description}</td>
                      <td className="tabular px-3 py-2.5 text-right text-ink-600">
                        {line.quantity}
                      </td>
                      <td className="tabular px-3 py-2.5 text-right text-ink-600">
                        {line.receivedQuantity}
                      </td>
                      <td className="tabular px-3 py-2.5 text-right font-medium text-ink-900">
                        {line.outstandingQuantity}
                      </td>
                      <td className="tabular px-5 py-2.5 text-right">
                        <Money
                          amount={line.lineAmount.amount}
                          currency={line.lineAmount.currency}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardBody>
          </Card>

          {receivable && can(session, 'purchase_order:receive') && (
            <ReceivePanel order={order} />
          )}

          {instance !== null && (
            <Card>
              <CardHeader
                title="Approval"
                description="The same chain machinery every other kind of spend uses."
              />
              <CardBody>
                <ApprovalTimeline instance={instance} />
              </CardBody>
            </Card>
          )}
        </div>

        <div className="flex flex-col gap-4">
          <OrderActions order={order} canRaise={can(session, 'purchase_order:create')} />
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

function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

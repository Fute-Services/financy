import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  CARD_STATUS_LABELS,
  CARD_TYPE_LABELS,
  LIMIT_PERIOD_LABELS,
  type CardDetail,
  type OffsetCollection,
  type Resource,
  type TransactionRecord,
} from '@financy/contracts';
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  DataTable,
  Money,
  PermissionState,
  ScopeEmptyState,
  StatusBadge,
  type Column,
} from '@financy/ui';

import { PageHeader } from '@/components/page-header';
import { ApiError, apiFetch } from '@/lib/api';
import { can, getSession } from '@/lib/session';
import { CardActions } from './card-actions';
import { LimitHistory } from './limit-history';

interface Props {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;

  try {
    const { data } = await apiFetch<Resource<CardDetail>>(`/cards/${id}`);
    return { title: data.name };
  } catch {
    return { title: 'Card' };
  }
}

/**
 * One card: what it can spend, what it has spent, and every change to its
 * limit.
 *
 * **"Spent in this period" comes from the server.** It is not derived from the
 * transactions on this page — those are a page, and a total taken from a sample
 * and presented as a figure is the failure docs/19 forbids by name. Only
 * settled charges count: a pending authorisation can still change or lapse, and
 * counting one would show somebody as over a limit they have not reached.
 *
 * **The limit history is the point of the panel, not a detail.** "Who raised
 * this to 50,000, when, and why?" is a question an auditor asks, and an
 * `UPDATE` cannot answer it. Every change wrote a row.
 */
export default async function CardPage({ params }: Props): Promise<React.JSX.Element> {
  const { id } = await params;
  const session = await getSession();

  if (session === null || !can(session, 'card:read')) {
    return (
      <>
        <PageHeader title="Card" />
        <Card>
          <PermissionState permission="card:read" />
        </Card>
      </>
    );
  }

  let card: CardDetail;

  try {
    card = (await apiFetch<Resource<CardDetail>>(`/cards/${id}`)).data;
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }

  const transactions = can(session, 'transaction:read')
    ? await apiFetch<OffsetCollection<TransactionRecord>>(
        `/transactions?cardId=${encodeURIComponent(id)}&pageSize=10`,
      ).catch(() => null)
    : null;

  const columns: ReadonlyArray<Column<TransactionRecord>> = [
    {
      key: 'merchant',
      header: 'Merchant',
      render: (transaction) => (
        <Link
          href={`/transactions/${transaction.id}`}
          className="truncate text-ink-800 hover:text-cobalt-600 hover:underline"
        >
          {transaction.merchantName}
        </Link>
      ),
    },
    {
      key: 'date',
      header: 'When',
      render: (transaction) => (
        <time dateTime={transaction.occurredAt} className="tabular text-ink-600">
          {formatDate(transaction.occurredAt)}
        </time>
      ),
    },
    {
      key: 'amount',
      header: 'Amount',
      align: 'right',
      render: (transaction) => (
        <Money amount={transaction.amount.amount} currency={transaction.amount.currency} />
      ),
    },
  ];

  return (
    <>
      <div className="mb-1">
        <Link href="/cards" className="text-[13px] text-ink-500 hover:text-cobalt-600">
          ← Cards
        </Link>
      </div>

      <PageHeader
        title={card.name}
        description={`${CARD_TYPE_LABELS[card.cardType]} · held by ${card.holder.fullName}`}
        action={
          <CardActions
            card={card}
            canLock={can(session, 'card:lock')}
            canTerminate={can(session, 'card:terminate')}
            canSetLimit={can(session, 'card:update_limit')}
          />
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <StatusBadge status={card.status} label={CARD_STATUS_LABELS[card.status]} />
        {card.lastFour !== null && (
          <span className="font-mono text-[13px] text-ink-600">•••• {card.lastFour}</span>
        )}
        {card.expiryMonth !== null && card.expiryYear !== null && (
          <span className="tabular text-[13px] text-ink-500">
            expires {String(card.expiryMonth).padStart(2, '0')}/{String(card.expiryYear).slice(-2)}
          </span>
        )}
        {card.provider === 'mock' && (
          <Badge tone="warning" title="Issued by the mock provider. No real card exists.">
            Sandbox card
          </Badge>
        )}
      </div>

      {card.statusReason !== null && card.status !== 'ACTIVE' && (
        <div
          role="status"
          className="mb-4 rounded-[var(--radius-sm)] border border-[var(--color-warning-border)] bg-[var(--color-warning-fill)] px-3.5 py-2.5 text-[13px] text-[var(--color-warning-text)]"
        >
          <strong className="font-semibold">
            {card.status === 'FROZEN' ? 'Frozen: ' : 'Terminated: '}
          </strong>
          {card.statusReason}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-4">
          <Card>
            <CardHeader
              title="Spending"
              description="Settled charges only. A pending authorisation can still change or lapse."
            />
            <CardBody>
              <div className="grid grid-cols-2 gap-6">
                <Figure
                  label={`Spent ${LIMIT_PERIOD_LABELS[card.limitPeriod]}`}
                  value={
                    <Money
                      amount={card.spentInPeriod.amount}
                      currency={card.spentInPeriod.currency}
                    />
                  }
                  hint={`${String(card.transactionCount)} ${
                    card.transactionCount === 1 ? 'charge' : 'charges'
                  } in total`}
                />
                <Figure
                  label="Limit"
                  value={<Money amount={card.limit.amount} currency={card.limit.currency} />}
                  hint={LIMIT_PERIOD_LABELS[card.limitPeriod]}
                />
              </div>
            </CardBody>
          </Card>

          {transactions !== null && (
            <Card>
              <CardHeader
                title="Recent charges"
                description="The ten most recent. The full list is on the transactions screen."
                action={
                  <Link
                    href={`/transactions?cardId=${encodeURIComponent(card.id)}`}
                    className="text-[13px] text-cobalt-500 hover:underline"
                  >
                    See all
                  </Link>
                }
              />
              <CardBody className="p-0">
                <DataTable
                  columns={columns}
                  rows={transactions.data}
                  rowKey={(transaction) => transaction.id}
                  caption="Recent charges on this card"
                  density="compact"
                  emptyState={
                    <ScopeEmptyState
                      title="Nothing charged yet"
                      description="Charges appear here as they arrive from the provider or an import."
                    />
                  }
                />
              </CardBody>
            </Card>
          )}
        </div>

        <LimitHistory history={card.limitHistory} />
      </div>
    </>
  );
}

function Figure({
  label,
  value,
  hint,
}: {
  label: string;
  value: React.ReactNode;
  hint: string;
}): React.JSX.Element {
  return (
    <div>
      <div className="text-[12px] text-ink-500">{label}</div>
      <div className="mt-0.5 text-xl font-semibold text-ink-900">{value}</div>
      <div className="mt-0.5 text-[12px] text-ink-400">{hint}</div>
    </div>
  );
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

import type { Metadata } from 'next';
import Link from 'next/link';
import {
  CARD_STATUS_LABELS,
  CARD_TYPE_LABELS,
  LIMIT_PERIOD_LABELS,
  type CardRecord,
  type OffsetCollection,
  type OrganizationSettings,
  type Person,
  type Resource,
} from '@financy/contracts';
import {
  Badge,
  Card,
  DataTable,
  FilteredEmptyState,
  FirstRunEmptyState,
  Money,
  PermissionState,
  StatusBadge,
  type Column,
} from '@financy/ui';

import { PageHeader } from '@/components/page-header';
import { apiFetch } from '@/lib/api';
import { can, getSession } from '@/lib/session';
import { CardFilters } from './filters';
import { IssueCardButton } from './issue-card-button';

export const metadata: Metadata = { title: 'Cards' };

interface Props {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * Cards.
 *
 * **The limit and its period are one column, not two.** "€2,000" means nothing
 * until you say whether that is per transaction or per month, and splitting
 * them across columns is how somebody reads the amount and not the period.
 *
 * **A frozen card stays in the list, greyed.** Somebody looking for the card
 * they froze last week needs to see that it exists and is frozen, not an empty
 * space where it used to be. A terminated one stays too, for the same reason
 * and a stronger one: charges against it are still in the record.
 *
 * There is no card number anywhere on this page, because there is none in the
 * API response. The last four digits are what a person needs to recognise their
 * own card, and are all this system has ever stored.
 */
export default async function CardsPage({ searchParams }: Props): Promise<React.JSX.Element> {
  const session = await getSession();

  if (session === null || !can(session, 'card:read')) {
    return (
      <>
        <PageHeader title="Cards" />
        <Card>
          <PermissionState permission="card:read" />
        </Card>
      </>
    );
  }

  const params = await searchParams;
  const status = first(params['status']);
  const q = first(params['q']);
  const page = first(params['page']) ?? '1';

  const canIssue = can(session, 'card:create');

  const query = new URLSearchParams();
  if (status !== undefined) query.set('status', status);
  if (q !== undefined) query.set('q', q);
  query.set('page', page);
  query.set('pageSize', '25');

  // The pickers for the issue dialog are only fetched when the caller can
  // actually issue. Asking anyway would turn the whole page into a 403 for
  // somebody who is allowed to read the list.
  const [result, settings, people] = await Promise.all([
    apiFetch<OffsetCollection<CardRecord>>(`/cards?${query.toString()}`),
    canIssue ? apiFetch<Resource<OrganizationSettings>>('/organization') : Promise.resolve(null),
    canIssue && can(session, 'user:read')
      ? apiFetch<OffsetCollection<Person>>('/memberships?status=ACTIVE&pageSize=100')
      : Promise.resolve(null),
  ]);

  const columns: ReadonlyArray<Column<CardRecord>> = [
    {
      key: 'name',
      header: 'Card',
      render: (card) => (
        <div className="min-w-0">
          <Link
            href={`/cards/${card.id}`}
            className="truncate font-medium text-ink-900 hover:text-cobalt-600 hover:underline"
          >
            {card.name}
          </Link>
          <div className="truncate text-[12px] text-ink-500">
            {CARD_TYPE_LABELS[card.cardType]}
            {card.lastFour !== null && (
              <>
                {' · '}
                <span className="font-mono">•••• {card.lastFour}</span>
              </>
            )}
          </div>
        </div>
      ),
    },
    {
      key: 'holder',
      header: 'Held by',
      render: (card) => <span className="text-ink-700">{card.holder.fullName}</span>,
    },
    {
      key: 'limit',
      header: 'Limit',
      align: 'right',
      render: (card) => (
        <div>
          <Money amount={card.limit.amount} currency={card.limit.currency} />
          <div className="text-[12px] text-ink-500">{LIMIT_PERIOD_LABELS[card.limitPeriod]}</div>
        </div>
      ),
    },
    {
      key: 'expiry',
      header: 'Expires',
      render: (card) =>
        card.expiryMonth === null || card.expiryYear === null ? (
          <span className="text-ink-400">—</span>
        ) : (
          <span className="tabular text-ink-600">
            {String(card.expiryMonth).padStart(2, '0')}/{String(card.expiryYear).slice(-2)}
          </span>
        ),
    },
    {
      key: 'status',
      header: 'Status',
      align: 'right',
      render: (card) => (
        <div className="flex items-center justify-end gap-1.5">
          {card.provider === 'mock' && (
            // Said out loud rather than hidden. A sandbox card that looked real
            // is how a demo becomes somebody's expectation of production.
            <Badge tone="warning" title="Issued by the mock provider. No real card exists.">
              Sandbox
            </Badge>
          )}
          <StatusBadge status={card.status} label={CARD_STATUS_LABELS[card.status]} />
        </div>
      ),
    },
  ];

  const { totalCount, totalPages, page: currentPage } = result.pagination;

  return (
    <>
      <PageHeader
        title="Cards"
        description="Spending authorisations. The limit is the control; the card is how it is applied."
        count={`${String(totalCount)} ${totalCount === 1 ? 'card' : 'cards'}`}
        action={
          canIssue && settings !== null ? (
            <IssueCardButton
              entities={settings.data.entities}
              departments={settings.data.departments}
              categories={settings.data.categories}
              people={people?.data ?? []}
              baseCurrency={settings.data.organization.baseCurrency}
            />
          ) : undefined
        }
      />

      <CardFilters />

      <Card>
        <DataTable
          columns={columns}
          rows={result.data}
          rowKey={(card) => card.id}
          caption="Cards in this organisation"
          emptyState={
            status !== undefined || q !== undefined ? (
              <FilteredEmptyState />
            ) : (
              <FirstRunEmptyState
                title="No cards yet"
                description="A card carries a limit and a period — how much, how often. Charges against it arrive as transactions, and policy still decides what may be spent."
              />
            )
          }
        />
      </Card>

      {totalPages > 1 && (
        <nav
          className="mt-4 flex items-center justify-between text-[13px] text-ink-500"
          aria-label="Pagination"
        >
          <span>
            Page {currentPage} of {totalPages}
          </span>
          <div className="flex gap-2">
            <PageLink page={currentPage - 1} disabled={currentPage <= 1} label="Previous" />
            <PageLink page={currentPage + 1} disabled={currentPage >= totalPages} label="Next" />
          </div>
        </nav>
      )}
    </>
  );
}

function first(value: string | string[] | undefined): string | undefined {
  const single = Array.isArray(value) ? value[0] : value;
  return single === undefined || single === '' ? undefined : single;
}

function PageLink({
  page,
  disabled,
  label,
}: {
  page: number;
  disabled: boolean;
  label: string;
}): React.JSX.Element {
  if (disabled) {
    return (
      <span className="rounded-[var(--radius-sm)] border border-line px-2.5 py-1 text-ink-300">
        {label}
      </span>
    );
  }

  return (
    <a
      href={`/cards?page=${String(page)}`}
      className="rounded-[var(--radius-sm)] border border-line px-2.5 py-1 text-ink-700 hover:bg-ink-50"
    >
      {label}
    </a>
  );
}

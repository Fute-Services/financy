import type { Metadata } from 'next';
import {
  Badge,
  BudgetMeter,
  Card,
  CardBody,
  CardHeader,
  DataTable,
  KpiCard,
  Money,
  StatusBadge,
  type Column,
} from '@financy/ui';
import { PageHeader } from '@/components/page-header';
import { PreviewBanner } from '@/components/preview-banner';
import {
  PREVIEW_BUDGETS,
  PREVIEW_CURRENCY,
  PREVIEW_KPIS,
  PREVIEW_REQUESTS,
  type PreviewBudget,
  type PreviewRequest,
} from '@/lib/preview-data';

export const metadata: Metadata = { title: 'Overview' };

/**
 * Overview.
 *
 * In the finished product every value here comes from `GET /v1/dashboard/*`
 * and is scoped to the caller's role — an employee sees their own spend, a
 * manager their department, finance the organisation. No figure is ever
 * computed in the browser (docs/15-REPORTING-ANALYTICS.md §1).
 *
 * Until that endpoint exists, the page renders preview data behind an
 * unmissable banner.
 */
export default function OverviewPage(): React.JSX.Element {
  return (
    <>
      <PageHeader
        title="Overview"
        description="Where the organisation stands right now — spend, approvals, evidence, and budget."
        phase={4}
      />

      <PreviewBanner endpoint="GET /v1/dashboard/summary" />

      {/* KPI row */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {PREVIEW_KPIS.map((kpi) => (
          <KpiCard
            key={kpi.label}
            label={kpi.label}
            value={
              kpi.amount ? (
                <Money amount={kpi.amount} currency={PREVIEW_CURRENCY} compact />
              ) : (
                kpi.count
              )
            }
            delta={kpi.delta}
            deltaDirection={kpi.direction}
            deltaIsGood={kpi.goodWhenUp}
            hint={kpi.hint}
          />
        ))}
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-3">
        {/* Approval queue */}
        <Card className="xl:col-span-2">
          <CardHeader
            title="Needs attention"
            description="Requests awaiting a decision, and those the policy engine stopped."
            action={<Badge tone="pending">{PREVIEW_REQUESTS.length} open</Badge>}
          />
          <DataTable<PreviewRequest>
            rows={PREVIEW_REQUESTS}
            rowKey={(row) => row.id}
            columns={REQUEST_COLUMNS}
            caption="Spend requests needing attention"
          />
        </Card>

        {/* Budget health */}
        <Card>
          <CardHeader title="Budget health" description="Actual against plan, this quarter." />
          <CardBody className="space-y-5">
            {PREVIEW_BUDGETS.map((budget) => (
              <BudgetRow key={budget.id} budget={budget} />
            ))}
          </CardBody>
        </Card>
      </div>

      {/* What is actually built — the honest status panel */}
      <Card className="mt-6">
        <CardHeader
          title="Build status"
          description="What exists in this repository today, and what comes next."
        />
        <CardBody>
          <div className="grid grid-cols-1 gap-x-8 gap-y-4 md:grid-cols-2">
            <StatusGroup
              heading="Done"
              tone="success"
              items={[
                'Documentation: 24 documents, 25 diagrams',
                '@financy/core — Money, errors, ids, state machines',
                '319 tests, 100% line coverage on core',
                'Design system tokens and primitives',
                'Application shell and permission-aware navigation',
              ]}
            />
            <StatusGroup
              heading="Next"
              tone="pending"
              items={[
                'packages/contracts — Zod schemas shared by API and web',
                'packages/db — Prisma schema, ~45 tables',
                'apps/api — NestJS bootstrap, guards, audit',
                'Phase 1 — auth, organisation, RBAC, audit log, People',
                'Phase 2 — policy engine and approvals',
              ]}
            />
          </div>
        </CardBody>
      </Card>
    </>
  );
}

const REQUEST_COLUMNS: ReadonlyArray<Column<PreviewRequest>> = [
  {
    key: 'reference',
    header: 'Reference',
    width: '130px',
    render: (row) => <span className="font-mono text-[13px] text-ink-600">{row.reference}</span>,
  },
  {
    key: 'requester',
    header: 'Requester',
    render: (row) => (
      <div className="min-w-0">
        <p className="truncate font-medium text-ink-800">{row.requester}</p>
        <p className="truncate text-xs text-ink-500">{row.department}</p>
      </div>
    ),
  },
  {
    key: 'category',
    header: 'Category',
    render: (row) => <span className="text-ink-600">{row.category}</span>,
  },
  {
    key: 'amount',
    header: 'Amount',
    align: 'right',
    width: '120px',
    render: (row) => (
      <Money amount={row.amount} currency={PREVIEW_CURRENCY} className="font-medium" />
    ),
  },
  {
    key: 'status',
    header: 'Status',
    width: '160px',
    render: (row) => <StatusBadge status={row.status} />,
  },
  {
    key: 'age',
    header: 'Age',
    align: 'right',
    width: '60px',
    render: (row) => <span className="text-ink-500">{row.age}</span>,
  },
];

function BudgetRow({ budget }: { budget: PreviewBudget }): React.JSX.Element {
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <p className="truncate text-sm font-medium text-ink-800">{budget.name}</p>
        <Money
          amount={budget.remaining}
          currency={PREVIEW_CURRENCY}
          compact
          colorNegative
          className="text-xs"
        />
      </div>
      <BudgetMeter percent={budget.utilization} />
      <p className="mt-1 text-xs text-ink-500">
        <Money amount={budget.spent} currency={PREVIEW_CURRENCY} compact /> of{' '}
        <Money amount={budget.allocated} currency={PREVIEW_CURRENCY} compact /> spent
      </p>
    </div>
  );
}

function StatusGroup({
  heading,
  tone,
  items,
}: {
  heading: string;
  tone: 'success' | 'pending';
  items: string[];
}): React.JSX.Element {
  return (
    <div>
      <Badge tone={tone} dot>
        {heading}
      </Badge>
      <ul className="mt-3 space-y-1.5">
        {items.map((item) => (
          <li key={item} className="flex gap-2 text-sm text-ink-600">
            <span className="mt-2 size-1 shrink-0 rounded-full bg-ink-300" aria-hidden="true" />
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

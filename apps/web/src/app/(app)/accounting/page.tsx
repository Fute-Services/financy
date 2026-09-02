import type { Metadata } from 'next';
import type {
  AccountingCodeRecord,
  AccountingMappingRecord,
  AccountingPeriodRecord,
  ExportBatchRecord,
  OffsetCollection,
  Resource,
} from '@financy/contracts';
import { ACCOUNTING_CODE_TYPE_LABELS } from '@financy/contracts';
import {
  Card,
  CardBody,
  CardHeader,
  DataTable,
  Money,
  PermissionState,
  StatusBadge,
  type Column,
} from '@financy/ui';

import { PageHeader } from '@/components/page-header';
import { apiFetch } from '@/lib/api';
import { can, getSession } from '@/lib/session';
import { ExportRunner } from './export-runner';

export const metadata: Metadata = { title: 'Accounting' };

/**
 * The accounting screen.
 *
 * ## The export runner is the whole page, and the rest is context
 *
 * Everything else here — the chart, the rules, the closed periods — exists to
 * make one action safe: handing a month to a ledger somebody else keeps. So the
 * runner is first, and the dry run is the default press, because the first
 * question anybody asks before an export is how many records are not ready.
 *
 * ## Past batches are listed with their checksums
 *
 * Not because anybody reads a checksum for pleasure, but because "is what you
 * received what we sent?" is a question answered by comparing one number, and
 * the number has to be somewhere a person can find it months later.
 */
export default async function AccountingPage(): Promise<React.JSX.Element> {
  const session = await getSession();

  if (session === null || !can(session, 'accounting:export')) {
    return (
      <>
        <PageHeader title="Accounting" />
        <Card>
          <PermissionState permission="accounting:export" />
        </Card>
      </>
    );
  }

  const [batches, periods, codes, mappings] = await Promise.all([
    apiFetch<OffsetCollection<ExportBatchRecord>>('/accounting/exports?pageSize=10'),
    apiFetch<Resource<AccountingPeriodRecord[]>>('/accounting/periods').catch(() => ({
      data: [] as AccountingPeriodRecord[],
    })),
    can(session, 'accounting_code:manage')
      ? apiFetch<OffsetCollection<AccountingCodeRecord>>(
          '/accounting/codes?activeOnly=true&pageSize=200',
        ).catch(() => ({ data: [] as AccountingCodeRecord[] }))
      : Promise.resolve({ data: [] as AccountingCodeRecord[] }),
    can(session, 'accounting_code:manage')
      ? apiFetch<Resource<AccountingMappingRecord[]>>('/accounting/mappings').catch(() => ({
          data: [] as AccountingMappingRecord[],
        }))
      : Promise.resolve({ data: [] as AccountingMappingRecord[] }),
  ]);

  const batchColumns: Column<ExportBatchRecord>[] = [
    {
      key: 'reference',
      header: 'Batch',
      render: (batch) => (
        <div className="min-w-0">
          <div className="font-medium text-ink-900">{batch.reference}</div>
          <div className="truncate text-[12px] text-ink-500">
            {formatDay(batch.periodStart)} – {formatDay(batch.periodEnd)}
          </div>
        </div>
      ),
    },
    {
      key: 'rows',
      header: 'Rows',
      align: 'right',
      width: '80px',
      render: (batch) => <span className="tabular">{batch.rowCount}</span>,
    },
    {
      key: 'total',
      header: 'Debits',
      align: 'right',
      render: (batch) => (
        <Money amount={batch.totals.debits.amount} currency={batch.totals.debits.currency} />
      ),
    },
    {
      key: 'checksum',
      header: 'Checksum',
      render: (batch) => (
        <code className="text-[11px] text-ink-500">
          {batch.checksum === '' ? '—' : `${batch.checksum.slice(0, 12)}…`}
        </code>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      width: '110px',
      render: (batch) => (
        <StatusBadge
          status={batch.status}
          label={batch.status === 'COMPLETED' ? 'Exported' : 'Refused'}
        />
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Accounting"
        description="Handing a period to the ledger. Only reviewed and coded records leave, and nothing leaves twice."
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex min-w-0 flex-col gap-4">
          <ExportRunner />

          <Card className="overflow-hidden">
            <CardHeader
              title="Past exports"
              description="Each batch names what it contained and what it summed to. The checksum is over the exact rows."
            />
            {batches.data.length === 0 ? (
              <CardBody>
                <p className="text-[13px] text-ink-500">Nothing has been exported yet.</p>
              </CardBody>
            ) : (
              <DataTable
                columns={batchColumns}
                rows={batches.data}
                rowKey={(batch) => batch.id}
                density="compact"
                caption="Export batches"
              />
            )}
          </Card>
        </div>

        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader
              title="Closed periods"
              description="A closed period exports nothing. Reopening is possible, recorded, and needs a reason."
            />
            <CardBody className="p-0">
              {periods.data.length === 0 ? (
                <p className="px-5 py-4 text-[13px] text-ink-500">Nothing is closed.</p>
              ) : (
                <ul className="divide-y divide-[var(--border-subtle)]">
                  {periods.data.map((period) => (
                    <li key={period.id} className="px-5 py-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[13px] text-ink-800">
                          {formatDay(period.periodStart)} – {formatDay(period.periodEnd)}
                        </span>
                        <StatusBadge
                          status={period.isClosed ? 'CLOSED' : 'REOPENED'}
                          label={period.isClosed ? 'Closed' : 'Reopened'}
                        />
                      </div>
                      <div className="mt-0.5 text-[12px] text-ink-500">
                        {period.isClosed
                          ? `Closed by ${period.closedBy.fullName}`
                          : (period.reopenReason ?? 'Reopened')}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>

          {can(session, 'accounting_code:manage') && (
            <Card>
              <CardHeader
                title="Mapping"
                description="First rule by priority wins, the same as policy."
              />
              <CardBody className="p-0">
                {mappings.data.length === 0 ? (
                  <p className="px-5 py-4 text-[13px] text-ink-500">
                    No rules yet. Nothing can be exported until at least one exists — a rule with
                    every condition blank is the catch-all.
                  </p>
                ) : (
                  <ul className="divide-y divide-[var(--border-subtle)]">
                    {mappings.data.map((rule) => (
                      <li key={rule.id} className="px-5 py-2.5">
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-[13px] text-ink-800">{rule.name}</span>
                          <span className="tabular text-[12px] text-ink-400">
                            {rule.priority}
                          </span>
                        </div>
                        <div className="text-[12px] text-ink-500">
                          → {rule.glAccount.code} {rule.glAccount.name}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </CardBody>
            </Card>
          )}

          {can(session, 'accounting_code:manage') && codes.data.length > 0 && (
            <Card>
              <CardHeader title="Codes" description={`${codes.data.length} active.`} />
              <CardBody className="flex flex-wrap gap-1.5">
                {codes.data.slice(0, 24).map((code) => (
                  <span
                    key={code.id}
                    title={`${ACCOUNTING_CODE_TYPE_LABELS[code.codeType]} · ${code.name}`}
                    className="rounded-[var(--radius-sm)] bg-ink-100 px-2 py-0.5 text-[12px] text-ink-700"
                  >
                    {code.code}
                  </span>
                ))}
              </CardBody>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}

function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  REPORT_KEYS,
  REPORT_LABELS,
  REPORT_QUESTIONS,
  type ReportKey,
  type ReportResult,
  type Resource,
} from '@financy/contracts';
import { Card, CardBody, DataTable, Money, PermissionState, type Column } from '@financy/ui';

import { PageHeader } from '@/components/page-header';
import { ApiError, apiFetch } from '@/lib/api';
import { can, getSession } from '@/lib/session';
import { ReportFilterBar } from './filter-bar';

/**
 * What one cell of a report row can be.
 *
 * Written out rather than indexed off the contract type: the schema is a
 * `z.record`, and indexing its inferred type widens the union back to `{}`,
 * which defeats the narrowing this file relies on to avoid stringifying an
 * object into a financial table.
 */
type ReportCell = string | number | boolean | { amount: string; currency: string } | null | undefined;

interface Props {
  params: Promise<{ key: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { key } = await params;

  return {
    title: (REPORT_LABELS as Record<string, string>)[key] ?? 'Report',
  };
}

/**
 * One report.
 *
 * ## Nothing on this page is calculated here
 *
 * The columns, the rows, the totals, the percentages, the period label — all
 * of it arrives from the server (docs/15 §1). This file decides where things
 * sit and how money is formatted, and it has no arithmetic in it at all. That
 * is what makes the export and the screen agree: they are the same query.
 *
 * ## The totals row is the server's, not a sum of what is displayed
 *
 * Paginated rows cannot be added up correctly by definition, and a footer that
 * quietly totalled only the visible page would be wrong in the direction that
 * looks plausible.
 *
 * ## Excluded rows are stated
 *
 * A report in one currency drops records in the others, and it says how many.
 * A total that silently omitted a third of the spend looks exactly like a total
 * that did not.
 */
export default async function ReportPage({
  params,
  searchParams,
}: Props): Promise<React.JSX.Element> {
  const session = await getSession();
  const { key } = await params;

  if (!(REPORT_KEYS as readonly string[]).includes(key)) notFound();

  const reportKey = key as ReportKey;

  if (session === null || !can(session, 'report:read')) {
    return (
      <>
        <PageHeader title={REPORT_LABELS[reportKey]} />
        <Card>
          <PermissionState permission="report:read" />
        </Card>
      </>
    );
  }

  const given = await searchParams;
  const query = new URLSearchParams();

  for (const name of [
    'datePreset',
    'dateFrom',
    'dateTo',
    'interval',
    'currency',
    'entityIds',
    'departmentIds',
    'categoryIds',
    'paymentMethods',
    'page',
  ]) {
    const value = Array.isArray(given[name]) ? given[name][0] : given[name];
    if (value !== undefined && value !== '') query.set(name, value);
  }

  let report: ReportResult;

  try {
    report = (await apiFetch<Resource<ReportResult>>(`/reports/${reportKey}?${query.toString()}`))
      .data;
  } catch (error) {
    if (error instanceof ApiError && error.status === 403) {
      return (
        <>
          <PageHeader title={REPORT_LABELS[reportKey]} />
          <Card>
            <PermissionState permission="report:read" />
          </Card>
        </>
      );
    }
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }

  const columns: Column<Record<string, unknown>>[] = report.columns.map((column) => ({
    key: column.key,
    header: column.label,
    align: column.kind === 'money' || column.kind === 'number' || column.kind === 'percent'
      ? 'right'
      : 'left',
    render: (row) => renderCell(toCell(row[column.key]), column.kind),
  }));

  const exportHref = `/api/reports/${reportKey}/export?${query.toString()}`;

  return (
    <>
      <div className="mb-1">
        <Link href="/reports" className="text-[13px] text-ink-500 hover:text-cobalt-600">
          ← Reports
        </Link>
      </div>

      <PageHeader
        title={REPORT_LABELS[reportKey]}
        description={REPORT_QUESTIONS[reportKey]}
        action={
          can(session, 'report:export') ? (
            <a
              href={exportHref}
              className="inline-flex h-8 items-center rounded-[var(--radius-sm)] border border-line bg-white px-3 text-[13px] text-ink-700 hover:border-cobalt-300"
            >
              Export CSV
            </a>
          ) : undefined
        }
      />

      <ReportFilterBar reportKey={reportKey} />

      <div className="mb-4 flex flex-wrap items-baseline gap-x-6 gap-y-2">
        <span className="text-[13px] text-ink-600">
          {report.period.label}
          {report.currency === null ? '' : ` · ${report.currency}`}
        </span>

        {Object.entries(report.totals).map(([name, value]) => (
          <span key={name} className="text-[13px]">
            <span className="text-ink-500">{humanise(name)}: </span>
            <span className="tabular font-medium text-ink-900">
              {renderTotal(toCell(value))}
            </span>
          </span>
        ))}
      </div>

      {report.excludedForCurrency > 0 && (
        <div className="mb-4 rounded-[var(--radius-sm)] border border-[var(--color-warning-border)] bg-[var(--color-warning-bg)] px-4 py-2.5 text-[13px] text-[var(--color-warning-text)]">
          {report.excludedForCurrency} record
          {report.excludedForCurrency === 1 ? ' is' : 's are'} in another currency and{' '}
          {report.excludedForCurrency === 1 ? 'is' : 'are'} not counted above. Change the currency
          to see {report.excludedForCurrency === 1 ? 'it' : 'them'}.
        </div>
      )}

      {report.rows.length === 0 ? (
        <Card>
          <CardBody>
            <p className="text-[13px] text-ink-500">
              Nothing matched. That is an answer too — either the period is quiet, or the filters
              are narrower than the data.
            </p>
          </CardBody>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <DataTable
            columns={columns}
            rows={report.rows}
            rowKey={(row) => rowIdentity(row)}
            caption={REPORT_LABELS[reportKey]}
          />
        </Card>
      )}

      {report.totalRows > report.rows.length && (
        <p className="mt-3 text-[12px] text-ink-500">
          Showing {report.rows.length} of {report.totalRows}. The totals above cover all of them.
        </p>
      )}
    </>
  );
}

/**
 * Narrow one value from a row the server shaped.
 *
 * The row arrives as a record of unknowns — the contract types it as a union,
 * but indexing a `z.record` widens it back. Narrowing here once means every
 * render path below knows what it is holding, and anything unrecognised
 * becomes `null` rather than `[object Object]` in a table of money.
 */
function toCell(value: unknown): ReportCell {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'object' && 'amount' in value && 'currency' in value) {
    const { amount, currency } = value;

    if (typeof amount === 'string' && typeof currency === 'string') return { amount, currency };
  }

  return null;
}

/**
 * A share of the whole, as a number and a bar.
 *
 * The number alone is accurate and unscannable: finding the three departments
 * that account for most of the spend means reading twenty figures and holding
 * them in your head. The bar does that comparison for the eye, and the number
 * stays because a bar cannot be read from a printout, in greyscale, or by a
 * screen reader.
 *
 * The width is a ratio of a value the **server** computed. No money is being
 * divided here.
 */
function Share({ percent }: { percent: number }): React.JSX.Element {
  const clamped = Math.min(Math.max(percent, 0), 100);

  return (
    <span className="flex items-center justify-end gap-2">
      <span
        className="h-1.5 w-16 shrink-0 overflow-hidden rounded-full bg-ink-100"
        aria-hidden="true"
      >
        <span
          className="block h-full rounded-full bg-[var(--color-chart-1)]"
          style={{ width: `${String(clamped)}%` }}
        />
      </span>
      <span className="tabular w-11 text-right">{percent}%</span>
    </span>
  );
}

/**
 * A stable key for a row whose shape the server decided.
 *
 * Report rows have no id — they are aggregates, and two of them can legitimately
 * share every visible value. The identity is therefore the row's own contents,
 * which is stable across a re-render and unique in practice.
 */
function rowIdentity(row: Record<string, unknown>): string {
  return JSON.stringify(row);
}

/**
 * One cell, formatted by what it is rather than by what it looks like.
 *
 * The value is the union a report row can hold, and each branch narrows to
 * something with a real textual form. Falling back to `String(value)` on an
 * unknown would render `[object Object]` into a financial table, which is the
 * one thing worse than rendering nothing.
 */
function renderCell(value: ReportCell, kind: string): React.ReactNode {
  if (value === null || value === undefined) {
    return <span className="text-ink-400">—</span>;
  }

  if (typeof value === 'object') {
    return <Money amount={value.amount} currency={value.currency} />;
  }

  if (typeof value === 'boolean') return value ? 'Yes' : 'No';

  if (kind === 'percent') return <Share percent={Number(value)} />;
  if (kind === 'number') return <span className="tabular">{value}</span>;
  if (kind === 'date') return <span>{formatDay(String(value))}</span>;

  return String(value);
}

function renderTotal(value: ReportCell): React.ReactNode {
  if (value === null || value === undefined) return '—';

  if (typeof value === 'object') {
    return <Money amount={value.amount} currency={value.currency} />;
  }

  return String(value);
}

/** `previousPeriod` → `Previous period`. The keys are the server's, not prose. */
function humanise(name: string): string {
  const spaced = name.replaceAll(/([A-Z])/g, ' $1').toLowerCase();
  return `${spaced.charAt(0).toUpperCase()}${spaced.slice(1)}`;
}

function formatDay(iso: string): string {
  const date = new Date(iso);

  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        timeZone: 'UTC',
      });
}

/**
 * Reports (FR-RPT-001…005; epics 4.2 and 4.4; docs/15).
 *
 * ## One filter model, every report
 *
 * The same shape drives every report, every export, and the dashboard. A
 * per-report filter schema sounds tidier and produces twelve subtly different
 * meanings of `dateFrom`, which is how two reports that should agree stop
 * agreeing.
 *
 * ## Unknown filters are refused, never ignored
 *
 * A typo'd parameter that is silently dropped means somebody believes an export
 * was filtered when it was not — and then sends it to a person who should not
 * see all of it (docs/15 §4). `strictObject` is the whole control.
 *
 * ## Every figure is a string with a currency beside it
 *
 * Nothing here is a JSON number. A number is a float by the time it reaches the
 * browser, and a report whose totals are floats is a report that disagrees with
 * the ledger in the fourth decimal place for reasons nobody can locate.
 */

import { z } from 'zod';

import { idSchema, optionalText, timestampSchema } from './primitives.js';

/**
 * The report catalogue (docs/15 §3).
 *
 * The last four are close-readiness reports. They exist because the daily
 * question in a finance team is not "how much did we spend" — it is "what is
 * still incomplete", and that is the report most spend tools under-serve.
 */
export const REPORT_KEYS = [
  'spend-total',
  'spend-by-department',
  'spend-by-category',
  'spend-by-vendor',
  'spend-by-person',
  'budget-vs-actual',
  'pending-approvals',
  'outstanding-reimbursements',
  'policy-exceptions',
  'uncategorised-transactions',
  'missing-receipts',
] as const;

export type ReportKey = (typeof REPORT_KEYS)[number];

export const REPORT_LABELS: Readonly<Record<ReportKey, string>> = {
  'spend-total': 'Total spend',
  'spend-by-department': 'Spend by department',
  'spend-by-category': 'Spend by category',
  'spend-by-vendor': 'Spend by merchant',
  'spend-by-person': 'Spend by person',
  'budget-vs-actual': 'Budget vs actual',
  'pending-approvals': 'Pending approvals',
  'outstanding-reimbursements': 'Outstanding reimbursements',
  'policy-exceptions': 'Policy exceptions',
  'uncategorised-transactions': 'Uncategorised transactions',
  'missing-receipts': 'Missing receipts',
};

/** What each report is actually for, in the words somebody would ask it in. */
export const REPORT_QUESTIONS: Readonly<Record<ReportKey, string>> = {
  'spend-total': 'How much did we spend, and how does it compare with before?',
  'spend-by-department': 'Which teams are spending?',
  'spend-by-category': 'What are we buying?',
  'spend-by-vendor': 'Who are we paying, and is it concentrating?',
  'spend-by-person': 'Who is spending?',
  'budget-vs-actual': 'Are we on plan, and where will we breach?',
  'pending-approvals': 'What is stuck, with whom, and for how long?',
  'outstanding-reimbursements': 'What do we owe our own people?',
  'policy-exceptions': 'Where is policy being bypassed or breached?',
  'uncategorised-transactions': 'What is blocking the close?',
  'missing-receipts': 'What evidence is outstanding, and from whom?',
};

export const DATE_PRESETS = [
  'MTD',
  'QTD',
  'YTD',
  'LAST_30D',
  'LAST_QUARTER',
  'LAST_YEAR',
  'CUSTOM',
] as const;
export type DatePreset = (typeof DATE_PRESETS)[number];

export const DATE_PRESET_LABELS: Readonly<Record<DatePreset, string>> = {
  MTD: 'This month',
  QTD: 'This quarter',
  YTD: 'This year',
  LAST_30D: 'Last 30 days',
  LAST_QUARTER: 'Last quarter',
  LAST_YEAR: 'Last year',
  CUSTOM: 'A period I choose',
};

export const REPORT_INTERVALS = ['DAY', 'WEEK', 'MONTH', 'QUARTER'] as const;
export type ReportInterval = (typeof REPORT_INTERVALS)[number];

export const REPORT_PAYMENT_METHODS = ['CARD', 'REIMBURSEMENT'] as const;
export type ReportPaymentMethod = (typeof REPORT_PAYMENT_METHODS)[number];

/**
 * How a report treats more than one currency (docs/15 §5).
 *
 * `SINGLE` is the default and the honest one: only records in the named
 * currency count, and the response says how many were left out. `GROUPED`
 * returns one total per currency. There is deliberately **no** converted mode
 * yet — a converted figure needs a rate recorded with it, and until the FX
 * provider lands any conversion here would be a number nobody can reproduce.
 */
export const CURRENCY_MODES = ['SINGLE', 'GROUPED'] as const;
export type CurrencyMode = (typeof CURRENCY_MODES)[number];

const idList = z
  .union([z.array(idSchema), idSchema])
  .transform((value) => (Array.isArray(value) ? value : [value]))
  .optional();

export const reportFiltersSchema = z.strictObject({
  datePreset: z.enum(DATE_PRESETS).default('MTD'),
  /** Required when the preset is `CUSTOM`; ignored otherwise. */
  dateFrom: z.iso.date().optional(),
  dateTo: z.iso.date().optional(),

  entityIds: idList,
  departmentIds: idList,
  memberIds: idList,
  categoryIds: idList,
  projectIds: idList,

  paymentMethods: z
    .union([z.array(z.enum(REPORT_PAYMENT_METHODS)), z.enum(REPORT_PAYMENT_METHODS)])
    .transform((value) => (Array.isArray(value) ? value : [value]))
    .optional(),

  currencyMode: z.enum(CURRENCY_MODES).default('SINGLE'),
  /** Defaults to the organisation's base currency when the mode is `SINGLE`. */
  currency: z.string().length(3).optional(),

  interval: z.enum(REPORT_INTERVALS).default('MONTH'),

  amountMin: z.string().optional(),
  amountMax: z.string().optional(),

  q: optionalText(200),

  page: z.coerce.number().int().min(1).catch(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).catch(50).default(50),
});

export type ReportFilters = z.infer<typeof reportFiltersSchema>;

/** One cell of money. Never a number, always with its currency. */
export const reportMoneySchema = z.object({ amount: z.string(), currency: z.string() });

/**
 * One row of a report.
 *
 * Values are a discriminated bag rather than a fixed shape, because eleven
 * reports return eleven different things and a union of eleven row types would
 * be re-declared in the client for every one of them. The `columns` array is
 * what makes it renderable: it names each key, says how to align it, and says
 * whether it is money.
 */
export const reportRowSchema = z.record(
  z.string(),
  z.union([z.string(), z.number(), z.boolean(), reportMoneySchema, z.null()]),
);

export const REPORT_COLUMN_KINDS = ['text', 'money', 'number', 'percent', 'date', 'status'] as const;
export type ReportColumnKind = (typeof REPORT_COLUMN_KINDS)[number];

export const reportColumnSchema = z.object({
  key: z.string(),
  label: z.string(),
  kind: z.enum(REPORT_COLUMN_KINDS),
  /** A link target for the row, when the cell identifies a record. */
  href: z.string().nullable().optional(),
});

export const reportResultSchema = z.object({
  key: z.enum(REPORT_KEYS),
  name: z.string(),
  /** The window actually used, after the preset was resolved. */
  period: z.object({ from: timestampSchema, to: timestampSchema, label: z.string() }),
  columns: z.array(reportColumnSchema),
  rows: z.array(reportRowSchema),
  /**
   * The report's own totals, computed on the server.
   *
   * Present so a client never sums the rows: pagination makes a client-side
   * total quietly wrong, and the wrongness scales with how interesting the
   * report is.
   */
  totals: z.record(z.string(), z.union([z.string(), z.number(), reportMoneySchema, z.null()])),
  currencyMode: z.enum(CURRENCY_MODES),
  currency: z.string().nullable(),
  /**
   * How many records were excluded for being in another currency.
   *
   * Stated rather than hidden. A total that silently dropped a third of the
   * spend is worse than one that says it did.
   */
  excludedForCurrency: z.int().min(0),
  totalRows: z.int().min(0),
  page: z.int().min(1),
  pageSize: z.int().min(1),
  generatedAt: timestampSchema,
});

export type ReportResult = z.infer<typeof reportResultSchema>;
export type ReportColumn = z.infer<typeof reportColumnSchema>;
export type ReportRow = z.infer<typeof reportRowSchema>;

export const reportSummarySchema = z.object({
  key: z.enum(REPORT_KEYS),
  name: z.string(),
  question: z.string(),
  permission: z.string(),
  /** False when the caller's role does not grant the report's permission. */
  available: z.boolean(),
});

export type ReportSummary = z.infer<typeof reportSummarySchema>;

// ── Dashboard (epic 4.3) ───────────────────────────────────────────────────

/**
 * What the dashboard shows, and to whom (docs/15 §7).
 *
 * **Role-awareness is a server-side scope, not a client-side filter.** The
 * employee's dashboard endpoint returns the employee's data; it does not
 * return the organisation's and hide most of it. A component that filtered
 * would leak the full set to anybody who opened the network tab.
 */
export const dashboardSchema = z.object({
  /** What the numbers cover, so the screen can say "your" or "the company's". */
  scope: z.enum(['OWN', 'DEPARTMENT', 'ORGANIZATION']),
  currency: z.string(),
  spendMonthToDate: reportMoneySchema,
  spendPreviousMonthToDate: reportMoneySchema,
  pendingApprovals: z.int().min(0),
  uncategorisedTransactions: z.int().min(0),
  missingReceipts: z.int().min(0),
  outstandingReimbursements: reportMoneySchema,
  budgets: z.array(
    z.object({
      id: idSchema,
      name: z.string(),
      utilization: z.number().nullable(),
      remaining: reportMoneySchema,
      overspendBehavior: z.string(),
    }),
  ),
  /** Spend per interval, oldest first, for the trend line. */
  trend: z.array(z.object({ label: z.string(), amount: reportMoneySchema })),
  /**
   * The things this person can actually do something about.
   *
   * A dashboard of numbers tells somebody how the month is going. This tells
   * them what to open, which is the only part anybody acts on.
   */
  needsAttention: z.array(
    z.object({
      kind: z.string(),
      label: z.string(),
      count: z.int().min(0),
      href: z.string(),
    }),
  ),
  generatedAt: timestampSchema,
});

export type DashboardSummary = z.infer<typeof dashboardSchema>;

// ── Export (epic 4.4) ──────────────────────────────────────────────────────

export const EXPORT_ROW_CEILING = 5000;

export type ExportFormat = 'CSV';

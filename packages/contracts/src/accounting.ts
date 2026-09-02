/**
 * Accounting — codes, mapping, export, and the close (FR-ACC-001…007; Phase 6).
 *
 * ## Export is the moment this system stops being the record
 *
 * Everything before it is provisional: a charge can be recoded, a bill can be
 * corrected, a claim can be returned. Once a record is in an export batch it
 * has been handed to a ledger somebody else reconciles, and changing it here
 * would make the two disagree with no way to tell which is right. So an
 * exported record is frozen, and a correction is a new record in the next
 * batch (FR-ACC-007).
 *
 * ## Only reviewed and coded records leave
 *
 * FR-ACC-003. A record with no GL account exported with a default one produces
 * a clean-looking file that is wrong, and nobody finds out until an accountant
 * does — in the following quarter, by which point the trail is cold. Unmapped
 * records go to a queue instead and block the export until somebody decides.
 *
 * ## A batch that does not balance is not written
 *
 * FR-ACC-006. Debits equal credits or the export aborts with the reason
 * recorded. Half a journal in a ledger is worse than none.
 */

import { z } from 'zod';

import { idSchema, nonEmptyString, optionalText, timestampSchema, versionSchema } from './primitives.js';

// ── Codes ──────────────────────────────────────────────────────────────────

export const ACCOUNTING_CODE_TYPES = ['GL_ACCOUNT', 'COST_CENTER', 'TAX_CODE'] as const;
export type AccountingCodeType = (typeof ACCOUNTING_CODE_TYPES)[number];

export const ACCOUNTING_CODE_TYPE_LABELS: Readonly<Record<AccountingCodeType, string>> = {
  GL_ACCOUNT: 'GL account',
  COST_CENTER: 'Cost centre',
  TAX_CODE: 'Tax code',
};

export const createAccountingCodeSchema = z.strictObject({
  codeType: z.enum(ACCOUNTING_CODE_TYPES),
  code: nonEmptyString(50),
  name: nonEmptyString(200),
  parentId: idSchema.nullable().optional(),
});

export const updateAccountingCodeSchema = z
  .strictObject({
    name: nonEmptyString(200).optional(),
    parentId: idSchema.nullable().optional(),
    /**
     * Retired, never deleted.
     *
     * A code that has ever appeared in an export has to keep resolving for
     * anybody reading last year's batch; deleting it turns an archived export
     * into a file of unexplained numbers.
     */
    isActive: z.boolean().optional(),
  })
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: 'Supply at least one field to change.',
  });

/**
 * Importing a chart of accounts.
 *
 * Whole-file, upsert by code, because that is how a chart arrives — as an
 * export from the ledger somebody already keeps. Row-by-row creation would
 * make importing four hundred accounts four hundred requests and one of them
 * would fail halfway.
 */
export const importAccountingCodesSchema = z.strictObject({
  codeType: z.enum(ACCOUNTING_CODE_TYPES),
  codes: z
    .array(z.strictObject({ code: nonEmptyString(50), name: nonEmptyString(200) }))
    .min(1)
    .max(2000),
});

export const accountingCodeSchema = z.object({
  id: idSchema,
  codeType: z.enum(ACCOUNTING_CODE_TYPES),
  code: z.string(),
  name: z.string(),
  parentId: idSchema.nullable(),
  isActive: z.boolean(),
  createdAt: timestampSchema,
});

export const listAccountingCodesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).catch(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).catch(100).default(100),
  codeType: z.enum(ACCOUNTING_CODE_TYPES).optional(),
  activeOnly: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .transform((value) => value === true || value === 'true')
    .optional(),
  q: optionalText(200),
});

// ── Mapping ────────────────────────────────────────────────────────────────

/**
 * A rule that derives accounting codes from a record's dimensions
 * (FR-ACC-002).
 *
 * Ordered by priority, **first match wins** — the same shape as the policy
 * engine, for the same reason: a set of rules that all apply is a set nobody
 * can reason about, and "which one decided this?" has to be answerable from the
 * rules rather than from the order a database happened to return them in.
 *
 * A condition left null means "any". A rule with every condition null is the
 * catch-all, which is how an organisation says "everything else goes to 6000".
 */
export const createAccountingMappingSchema = z.strictObject({
  name: nonEmptyString(200),
  priority: z.int().min(1).max(10_000).default(100),
  categoryId: idSchema.nullable().optional(),
  departmentId: idSchema.nullable().optional(),
  entityId: idSchema.nullable().optional(),
  vendorId: idSchema.nullable().optional(),
  spendType: z.enum(['CARD', 'REIMBURSEMENT', 'BILL', 'PURCHASE_ORDER', 'SPEND_REQUEST']).nullable().optional(),
  glAccountId: idSchema,
  costCenterId: idSchema.nullable().optional(),
  taxCodeId: idSchema.nullable().optional(),
});

export const updateAccountingMappingSchema = createAccountingMappingSchema
  .partial()
  .extend({ isActive: z.boolean().optional() })
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: 'Supply at least one field to change.',
  });

export const accountingMappingSchema = z.object({
  id: idSchema,
  name: z.string(),
  priority: z.int(),
  categoryId: idSchema.nullable(),
  departmentId: idSchema.nullable(),
  entityId: idSchema.nullable(),
  vendorId: idSchema.nullable(),
  spendType: z.string().nullable(),
  glAccount: z.object({ id: idSchema, code: z.string(), name: z.string() }),
  costCenter: z.object({ id: idSchema, code: z.string(), name: z.string() }).nullable(),
  taxCode: z.object({ id: idSchema, code: z.string(), name: z.string() }).nullable(),
  isActive: z.boolean(),
  version: versionSchema,
});

/**
 * The test harness FR-ACC-002 asks for.
 *
 * Answers "what would these rules do to a record shaped like this?" without a
 * record existing. Publishing a mapping and discovering what it does by
 * exporting a month is how an organisation ends up re-importing a ledger.
 */
export const simulateMappingSchema = z.strictObject({
  categoryId: idSchema.nullable().optional(),
  departmentId: idSchema.nullable().optional(),
  entityId: idSchema.nullable().optional(),
  vendorId: idSchema.nullable().optional(),
  spendType: z.enum(['CARD', 'REIMBURSEMENT', 'BILL', 'PURCHASE_ORDER', 'SPEND_REQUEST']).optional(),
});

export const mappingResultSchema = z.object({
  matched: z.boolean(),
  /** The rule that decided, and the ones that were considered and did not. */
  ruleId: idSchema.nullable(),
  ruleName: z.string().nullable(),
  glAccount: z.object({ code: z.string(), name: z.string() }).nullable(),
  costCenter: z.object({ code: z.string(), name: z.string() }).nullable(),
  taxCode: z.object({ code: z.string(), name: z.string() }).nullable(),
  /**
   * Why nothing matched, when nothing did.
   *
   * "No rule matched" sends somebody to read every rule. Naming the dimensions
   * that were carried in tells them which rule to write.
   */
  explanation: z.string(),
});

// ── Export ─────────────────────────────────────────────────────────────────

export const EXPORT_RECORD_TYPES = ['transaction', 'expense', 'bill'] as const;
export type ExportRecordType = (typeof EXPORT_RECORD_TYPES)[number];

export const createExportSchema = z.strictObject({
  periodStart: z.iso.date(),
  periodEnd: z.iso.date(),
  currency: z.string().length(3).optional(),
  recordTypes: z
    .union([z.array(z.enum(EXPORT_RECORD_TYPES)), z.enum(EXPORT_RECORD_TYPES)])
    .transform((value) => (Array.isArray(value) ? value : [value]))
    .optional(),
  /**
   * Check what would be exported without exporting it.
   *
   * A dry run marks nothing and writes no batch. It exists because the first
   * question anybody asks before an export is "how many are unmapped", and
   * finding out by running it for real is a batch they then have to explain.
   */
  dryRun: z.boolean().default(false),
});

export const EXPORT_BATCH_STATUSES = ['COMPLETED', 'FAILED'] as const;
export type ExportBatchStatus = (typeof EXPORT_BATCH_STATUSES)[number];

export const exportBatchItemSchema = z.object({
  id: idSchema,
  recordType: z.string(),
  recordId: idSchema,
  glAccountCode: z.string(),
  costCenterCode: z.string().nullable(),
  taxCode: z.string().nullable(),
  debit: z.object({ amount: z.string(), currency: z.string() }),
  credit: z.object({ amount: z.string(), currency: z.string() }),
  memo: z.string().nullable(),
});

export const exportBatchSchema = z.object({
  id: idSchema,
  reference: z.string(),
  exportType: z.string(),
  periodStart: timestampSchema,
  periodEnd: timestampSchema,
  rowCount: z.int().min(0),
  checksum: z.string(),
  totals: z.object({
    debits: z.object({ amount: z.string(), currency: z.string() }),
    credits: z.object({ amount: z.string(), currency: z.string() }),
  }),
  currency: z.string(),
  status: z.enum(EXPORT_BATCH_STATUSES),
  failureReason: z.string().nullable(),
  createdAt: timestampSchema,
});

export const exportBatchDetailSchema = exportBatchSchema.extend({
  items: z.array(exportBatchItemSchema),
});

/**
 * What a run would produce, or did.
 *
 * `unmapped` is the part anybody reads first: a run that exported nine hundred
 * records and left forty behind needs to name the forty, because those are the
 * ones somebody has to do something about before the month closes.
 */
export const exportResultSchema = z.object({
  batch: exportBatchSchema.nullable(),
  eligible: z.int().min(0),
  exported: z.int().min(0),
  unmapped: z.array(
    z.object({
      recordType: z.string(),
      recordId: idSchema,
      description: z.string(),
      amount: z.object({ amount: z.string(), currency: z.string() }),
      reason: z.string(),
    }),
  ),
  /** Present when the export was refused for not balancing (FR-ACC-006). */
  imbalance: z
    .object({
      debits: z.string(),
      credits: z.string(),
      difference: z.string(),
    })
    .nullable(),
  dryRun: z.boolean(),
});

export const listExportBatchesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).catch(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).catch(25).default(25),
});

// ── The close ──────────────────────────────────────────────────────────────

export const closePeriodSchema = z.strictObject({
  periodStart: z.iso.date(),
  periodEnd: z.iso.date(),
  note: optionalText(1000),
});

/**
 * Re-opening a closed period.
 *
 * Possible, recorded, and deliberately awkward: it needs a reason, and both the
 * close and the re-open stay on the record. Pretending re-opening never happens
 * is how a system ends up with two versions of a signed-off month and no way to
 * tell them apart.
 */
export const reopenPeriodSchema = z.strictObject({
  reason: nonEmptyString(500),
});

export const accountingPeriodSchema = z.object({
  id: idSchema,
  periodStart: timestampSchema,
  periodEnd: timestampSchema,
  closedAt: timestampSchema,
  closedBy: z.object({ membershipId: idSchema, fullName: z.string() }),
  note: z.string().nullable(),
  reopenedAt: timestampSchema.nullable(),
  reopenReason: z.string().nullable(),
  /** False once re-opened, which is what every write path checks. */
  isClosed: z.boolean(),
  version: versionSchema,
});

export type CreateAccountingCode = z.infer<typeof createAccountingCodeSchema>;
export type UpdateAccountingCode = z.infer<typeof updateAccountingCodeSchema>;
export type ImportAccountingCodes = z.infer<typeof importAccountingCodesSchema>;
export type AccountingCodeRecord = z.infer<typeof accountingCodeSchema>;
export type ListAccountingCodesQuery = z.infer<typeof listAccountingCodesQuerySchema>;

export type CreateAccountingMapping = z.infer<typeof createAccountingMappingSchema>;
export type UpdateAccountingMapping = z.infer<typeof updateAccountingMappingSchema>;
export type AccountingMappingRecord = z.infer<typeof accountingMappingSchema>;
export type SimulateMapping = z.infer<typeof simulateMappingSchema>;
export type MappingResult = z.infer<typeof mappingResultSchema>;

export type CreateExport = z.infer<typeof createExportSchema>;
export type ExportBatchRecord = z.infer<typeof exportBatchSchema>;
export type ExportBatchDetail = z.infer<typeof exportBatchDetailSchema>;
export type ExportResult = z.infer<typeof exportResultSchema>;
export type ListExportBatchesQuery = z.infer<typeof listExportBatchesQuerySchema>;

export type ClosePeriod = z.infer<typeof closePeriodSchema>;
export type ReopenPeriod = z.infer<typeof reopenPeriodSchema>;
export type AccountingPeriodRecord = z.infer<typeof accountingPeriodSchema>;

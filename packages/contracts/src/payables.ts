/**
 * Vendors, bills, and procurement (FR-VND-001…002, FR-BIL-001…004,
 * FR-PRC-001…003; Phase 5).
 *
 * ## A bill is a spend request that arrived backwards
 *
 * Somebody has already supplied something and now wants paying. It carries the
 * same question — who has to agree to this? — into the **same** engine, with
 * `spendType = BILL`. There is no second approval implementation here, and a
 * test asserts the shared code path, because two implementations of "who
 * approves" drift within a quarter and nobody can say which one is authoritative.
 *
 * ## Totals are never the client's
 *
 * A bill's total is the sum of its lines; a PO's is the sum of its lines. A
 * submitted total that disagreed with its own lines is a number that gets paid
 * and then reconciled by hand for a week.
 *
 * ## Nothing about a supplier is deleted
 *
 * A merged vendor keeps its row and points at whoever absorbed it, so every
 * invoice that ever referenced it still resolves to a supplier with a name.
 */

import { z } from 'zod';

import {
  idSchema,
  nonEmptyString,
  optionalText,
  positiveMoneySchema,
  timestampSchema,
  versionSchema,
} from './primitives.js';

// ── Vendors ────────────────────────────────────────────────────────────────

export const VENDOR_STATUSES = ['ACTIVE', 'INACTIVE', 'MERGED'] as const;
export type VendorStatus = (typeof VENDOR_STATUSES)[number];

export const VENDOR_STATUS_LABELS: Readonly<Record<VendorStatus, string>> = {
  ACTIVE: 'Active',
  INACTIVE: 'Not in use',
  MERGED: 'Merged into another',
};

/**
 * Bank details, which are the most attractive field in this system.
 *
 * Accepted on write, encrypted at rest, and **never returned**. The response
 * carries the last four digits, which is enough for a person to recognise an
 * account and not enough for anybody to pay into it.
 */
export const vendorBankDetailsSchema = z.strictObject({
  accountName: nonEmptyString(200),
  accountNumber: nonEmptyString(64),
  routingNumber: optionalText(64),
  iban: optionalText(64),
  swift: optionalText(16),
});

export const createVendorSchema = z.strictObject({
  name: nonEmptyString(200),
  legalName: optionalText(200),
  taxId: optionalText(64),
  categoryId: idSchema.nullable().optional(),
  email: z.email().optional(),
  phone: optionalText(50),
  website: optionalText(200),
  addressLine: optionalText(300),
  city: optionalText(100),
  postalCode: optionalText(20),
  countryCode: z.string().length(2).optional(),
  defaultCurrency: z.string().length(3).optional(),
  paymentTermsDays: z.int().min(0).max(365).default(30),
  bankDetails: vendorBankDetailsSchema.optional(),
  notes: optionalText(2000),
  /**
   * Create anyway, despite a near-duplicate.
   *
   * The duplicate check refuses by default and names what it matched. Two
   * suppliers really can share a name — a franchise, a rebrand — and the
   * override exists so the honest case is possible; it is deliberately an
   * explicit flag rather than a silent second row.
   */
  allowDuplicate: z.boolean().default(false),
});

export const updateVendorSchema = createVendorSchema
  .omit({ allowDuplicate: true })
  .partial()
  .extend({ status: z.enum(['ACTIVE', 'INACTIVE']).optional() })
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: 'Supply at least one field to change.',
  });

/**
 * Merging two suppliers.
 *
 * Non-destructive (FR-VND-002): the loser keeps its row, its status becomes
 * `MERGED`, and it points at the winner. Every bill that referenced it still
 * resolves — a merge that deleted the row would orphan invoices that an
 * auditor will ask about years later.
 */
export const mergeVendorSchema = z.strictObject({
  intoVendorId: idSchema,
  reason: optionalText(500),
});

export const vendorSchema = z.object({
  id: idSchema,
  name: z.string(),
  legalName: z.string().nullable(),
  taxId: z.string().nullable(),
  categoryId: idSchema.nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  website: z.string().nullable(),
  addressLine: z.string().nullable(),
  city: z.string().nullable(),
  postalCode: z.string().nullable(),
  countryCode: z.string().nullable(),
  defaultCurrency: z.string().nullable(),
  paymentTermsDays: z.int(),
  /** The last four digits. The rest never leaves the database. */
  bankAccountLast4: z.string().nullable(),
  hasBankDetails: z.boolean(),
  status: z.enum(VENDOR_STATUSES),
  mergedIntoId: idSchema.nullable(),
  notes: z.string().nullable(),
  createdAt: timestampSchema,
  version: versionSchema,
});

/** What a duplicate check found, with enough for a person to decide. */
export const vendorMatchSchema = z.object({
  id: idSchema,
  name: z.string(),
  taxId: z.string().nullable(),
  reason: z.enum(['SAME_NAME', 'SAME_TAX_ID']),
});

export const listVendorsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).catch(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).catch(25).default(25),
  status: z.enum(VENDOR_STATUSES).optional(),
  q: optionalText(200),
});

// ── Bills ──────────────────────────────────────────────────────────────────

export const BILL_STATUSES = [
  'DRAFT',
  'PENDING_APPROVAL',
  'APPROVED',
  'REJECTED',
  'PAID',
  'CANCELLED',
  'CREDIT_NOTE',
] as const;
export type BillStatus = (typeof BILL_STATUSES)[number];

export const BILL_STATUS_LABELS: Readonly<Record<BillStatus, string>> = {
  DRAFT: 'Draft',
  PENDING_APPROVAL: 'Awaiting approval',
  APPROVED: 'Approved to pay',
  REJECTED: 'Rejected',
  PAID: 'Paid',
  CANCELLED: 'Cancelled',
  CREDIT_NOTE: 'Credit note',
};

export const billLineInputSchema = z.strictObject({
  description: nonEmptyString(300),
  quantity: z.string().default('1'),
  unitAmount: z.string(),
  categoryId: idSchema.nullable().optional(),
  departmentId: idSchema.nullable().optional(),
  projectId: idSchema.nullable().optional(),
  /** The PO line this fulfils, which is what makes a three-way match possible. */
  purchaseOrderLineId: idSchema.nullable().optional(),
});

export const createBillSchema = z.strictObject({
  vendorId: idSchema,
  entityId: idSchema,
  /** The supplier's number, not ours. Unique per supplier (FR-BIL-002). */
  billNumber: nonEmptyString(100),
  issueDate: z.iso.date(),
  /** Defaults to the vendor's payment terms when absent. */
  dueDate: z.iso.date().optional(),
  currency: z.string().length(3),
  lines: z.array(billLineInputSchema).min(1).max(200),
  memo: optionalText(2000),
});

export const updateBillSchema = createBillSchema
  .partial()
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: 'Supply at least one field to change.',
  });

export const markBillPaidSchema = z.strictObject({
  paymentReference: nonEmptyString(100),
  paidAt: timestampSchema.optional(),
});

/**
 * Correcting a paid bill.
 *
 * A paid bill's amounts are immutable (FR-BIL-004) and the correction is a
 * credit note that offsets it. Editing the original would change a figure that
 * has already been paid, reported, and possibly exported to a ledger — and
 * nothing downstream would know.
 */
export const createCreditNoteSchema = z.strictObject({
  reason: nonEmptyString(500),
  /** Absent means the whole bill. */
  amount: positiveMoneySchema.optional(),
});

export const billLineSchema = z.object({
  id: idSchema,
  sequence: z.int(),
  description: z.string(),
  quantity: z.string(),
  unitAmount: z.object({ amount: z.string(), currency: z.string() }),
  lineAmount: z.object({ amount: z.string(), currency: z.string() }),
  categoryId: idSchema.nullable(),
  departmentId: idSchema.nullable(),
  projectId: idSchema.nullable(),
  purchaseOrderLineId: idSchema.nullable(),
});

export const billSchema = z.object({
  id: idSchema,
  reference: z.string(),
  billNumber: z.string(),
  status: z.enum(BILL_STATUSES),
  vendor: z.object({ id: idSchema, name: z.string() }),
  entityId: idSchema,
  issueDate: timestampSchema,
  dueDate: timestampSchema,
  total: z.object({ amount: z.string(), currency: z.string() }),
  currency: z.string(),
  approvalInstanceId: idSchema.nullable(),
  policyDecision: z.unknown().nullable(),
  paymentReference: z.string().nullable(),
  paidAt: timestampSchema.nullable(),
  creditsBillId: idSchema.nullable(),
  memo: z.string().nullable(),
  submittedAt: timestampSchema.nullable(),
  /** Negative when overdue, so a list can sort by urgency without arithmetic. */
  daysUntilDue: z.number(),
  createdAt: timestampSchema,
  version: versionSchema,
});

export const billDetailSchema = billSchema.extend({
  lines: z.array(billLineSchema),
  /** Present once a bill names PO lines (FR-PRC-003). */
  match: z
    .object({
      status: z.enum(['MATCHED', 'WITHIN_TOLERANCE', 'VARIANCE', 'NOT_RECEIVED']),
      /** Every line's own verdict, so a variance names the line that caused it. */
      lines: z.array(
        z.object({
          billLineId: idSchema,
          orderedQuantity: z.string(),
          receivedQuantity: z.string(),
          billedQuantity: z.string(),
          orderedAmount: z.object({ amount: z.string(), currency: z.string() }),
          billedAmount: z.object({ amount: z.string(), currency: z.string() }),
          variancePercent: z.number(),
          verdict: z.enum(['MATCHED', 'WITHIN_TOLERANCE', 'VARIANCE', 'NOT_RECEIVED']),
        }),
      ),
    })
    .nullable(),
});

export const listBillsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).catch(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).catch(25).default(25),
  status: z.enum(BILL_STATUSES).optional(),
  vendorId: idSchema.optional(),
  /** Bills whose due date has passed and which are not yet paid. */
  overdue: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .transform((value) => value === true || value === 'true')
    .optional(),
  q: optionalText(200),
});

// ── Purchase orders ────────────────────────────────────────────────────────

export const PURCHASE_ORDER_STATUSES = [
  'DRAFT',
  'PENDING_APPROVAL',
  'APPROVED',
  'REJECTED',
  'PARTIALLY_RECEIVED',
  'RECEIVED',
  'CLOSED',
  'CANCELLED',
] as const;
export type PurchaseOrderStatus = (typeof PURCHASE_ORDER_STATUSES)[number];

export const PURCHASE_ORDER_STATUS_LABELS: Readonly<Record<PurchaseOrderStatus, string>> = {
  DRAFT: 'Draft',
  PENDING_APPROVAL: 'Awaiting approval',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  PARTIALLY_RECEIVED: 'Partly arrived',
  RECEIVED: 'All arrived',
  CLOSED: 'Closed',
  CANCELLED: 'Cancelled',
};

export const purchaseOrderLineInputSchema = z.strictObject({
  description: nonEmptyString(300),
  quantity: z.string(),
  unitAmount: z.string(),
  categoryId: idSchema.nullable().optional(),
});

export const createPurchaseOrderSchema = z.strictObject({
  vendorId: idSchema,
  entityId: idSchema,
  currency: z.string().length(3),
  lines: z.array(purchaseOrderLineInputSchema).min(1).max(200),
  expectedDate: z.iso.date().optional(),
  departmentId: idSchema.nullable().optional(),
  projectId: idSchema.nullable().optional(),
  categoryId: idSchema.nullable().optional(),
  memo: optionalText(2000),
});

export const updatePurchaseOrderSchema = createPurchaseOrderSchema
  .partial()
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: 'Supply at least one field to change.',
  });

/**
 * Recording what arrived.
 *
 * Quantities per line, appended rather than set: a delivery that arrives in
 * two vans is two receipts, and overwriting the first with the second is how a
 * warehouse loses half a shipment on paper.
 */
export const receivePurchaseOrderSchema = z.strictObject({
  lines: z
    .array(
      z.strictObject({
        purchaseOrderLineId: idSchema,
        /** Negative is allowed — a correction is a negative receipt. */
        quantity: z.string(),
        note: optionalText(500),
      }),
    )
    .min(1)
    .max(200),
});

export const purchaseOrderLineSchema = z.object({
  id: idSchema,
  sequence: z.int(),
  description: z.string(),
  quantity: z.string(),
  unitAmount: z.object({ amount: z.string(), currency: z.string() }),
  lineAmount: z.object({ amount: z.string(), currency: z.string() }),
  receivedQuantity: z.string(),
  outstandingQuantity: z.string(),
  categoryId: idSchema.nullable(),
});

export const purchaseOrderSchema = z.object({
  id: idSchema,
  poNumber: z.string(),
  status: z.enum(PURCHASE_ORDER_STATUSES),
  vendor: z.object({ id: idSchema, name: z.string() }),
  entityId: idSchema,
  requester: z.object({ membershipId: idSchema, fullName: z.string() }),
  total: z.object({ amount: z.string(), currency: z.string() }),
  currency: z.string(),
  expectedDate: timestampSchema.nullable(),
  departmentId: idSchema.nullable(),
  projectId: idSchema.nullable(),
  categoryId: idSchema.nullable(),
  approvalInstanceId: idSchema.nullable(),
  policyDecision: z.unknown().nullable(),
  memo: z.string().nullable(),
  submittedAt: timestampSchema.nullable(),
  approvedAt: timestampSchema.nullable(),
  createdAt: timestampSchema,
  version: versionSchema,
});

export const purchaseOrderDetailSchema = purchaseOrderSchema.extend({
  lines: z.array(purchaseOrderLineSchema),
});

export const listPurchaseOrdersQuerySchema = z.object({
  page: z.coerce.number().int().min(1).catch(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).catch(25).default(25),
  status: z.enum(PURCHASE_ORDER_STATUSES).optional(),
  vendorId: idSchema.optional(),
  mine: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .transform((value) => value === true || value === 'true')
    .optional(),
  q: optionalText(200),
});

/**
 * How far a bill may differ from what was ordered and received before somebody
 * has to look at it (FR-PRC-003).
 *
 * Two and a half percent, and it is a **percentage rather than an amount**
 * because a fixed tolerance is either meaningless on a large order or
 * paralysing on a small one. Rounding, freight, and exchange move an invoice by
 * a fraction of a percent routinely; a tolerance of zero would send every one
 * of those to a human.
 */
export const MATCH_TOLERANCE_PERCENT = 2.5;

export type CreateVendor = z.infer<typeof createVendorSchema>;
export type UpdateVendor = z.infer<typeof updateVendorSchema>;
export type MergeVendor = z.infer<typeof mergeVendorSchema>;
export type VendorRecord = z.infer<typeof vendorSchema>;
export type VendorMatch = z.infer<typeof vendorMatchSchema>;
export type ListVendorsQuery = z.infer<typeof listVendorsQuerySchema>;

export type CreateBill = z.infer<typeof createBillSchema>;
export type UpdateBill = z.infer<typeof updateBillSchema>;
export type MarkBillPaid = z.infer<typeof markBillPaidSchema>;
export type CreateCreditNote = z.infer<typeof createCreditNoteSchema>;
export type BillRecord = z.infer<typeof billSchema>;
export type BillDetail = z.infer<typeof billDetailSchema>;
export type BillLineRecord = z.infer<typeof billLineSchema>;
export type ListBillsQuery = z.infer<typeof listBillsQuerySchema>;

export type CreatePurchaseOrder = z.infer<typeof createPurchaseOrderSchema>;
export type UpdatePurchaseOrder = z.infer<typeof updatePurchaseOrderSchema>;
export type ReceivePurchaseOrder = z.infer<typeof receivePurchaseOrderSchema>;
export type PurchaseOrderRecord = z.infer<typeof purchaseOrderSchema>;
export type PurchaseOrderDetail = z.infer<typeof purchaseOrderDetailSchema>;
export type PurchaseOrderLineRecord = z.infer<typeof purchaseOrderLineSchema>;
export type ListPurchaseOrdersQuery = z.infer<typeof listPurchaseOrdersQuerySchema>;

import type {
  CreateVendor,
  ListVendorsQuery,
  MergeVendor,
  UpdateVendor,
  VendorMatch,
  VendorRecord,
} from '@financy/contracts';
import { ConflictError, NotFoundError, ValidationError, newId } from '@financy/core';
import type { Prisma } from '@financy/db';
import { Injectable } from '@nestjs/common';

import { AuditService } from '../../platform/audit/index.js';
import { guardVersion } from '../../platform/concurrency/index.js';
import { CryptoService } from '../../platform/crypto/index.js';
import { DatabaseService } from '../../platform/database/index.js';
import { getOrganizationId } from '../../platform/request-context/index.js';

/**
 * Vendors (FR-VND-001…002, epic 5.1).
 *
 * ## Duplicates are refused before they exist, not merged afterwards
 *
 * "Acme Ltd.", "ACME Limited", and "acme ltd" are one supplier that three
 * people entered on three afternoons, and by the time anybody notices there are
 * invoices against all three and a payment run that pays two of them. The
 * create path normalises the name, checks the tax id, and **refuses** with the
 * matches named — with an explicit override for the honest case, because two
 * suppliers really can share a name.
 *
 * ## Bank details go in and never come out
 *
 * Encrypted at rest with the platform's own key, and the response carries the
 * last four digits only. This is the field a read-only foothold is worth
 * having; the shape of the API is what decides whether that foothold is worth
 * anything.
 *
 * ## A merge keeps both rows
 *
 * The loser's status becomes `MERGED` and it points at the winner. Every bill
 * that referenced it still resolves to a supplier with a name — a merge that
 * deleted the row would orphan invoices an auditor asks about years later.
 */
@Injectable()
export class VendorsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
    private readonly crypto: CryptoService,
  ) {}

  async list(query: ListVendorsQuery): Promise<{ items: VendorRecord[]; total: number }> {
    const where: Prisma.VendorWhereInput = {
      ...(query.status === undefined ? {} : { status: query.status }),
      ...(query.q === undefined
        ? {}
        : {
            OR: [
              { name: { contains: query.q, mode: 'insensitive' } },
              { legalName: { contains: query.q, mode: 'insensitive' } },
              { taxId: { contains: query.q, mode: 'insensitive' } },
            ],
          }),
    };

    const [total, rows] = await Promise.all([
      this.database.client.vendor.count({ where }),
      this.database.client.vendor.findMany({
        where,
        orderBy: { name: 'asc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);

    return { total, items: rows.map((row) => toRecord(row)) };
  }

  async get(id: string): Promise<VendorRecord> {
    const row = await this.database.client.vendor.findFirst({ where: { id } });

    if (row === null) throw new NotFoundError('Vendor');

    return toRecord(row);
  }

  async create(input: CreateVendor): Promise<VendorRecord> {
    const organizationId = requireOrganization();
    const normalized = normalizeVendorName(input.name);

    if (!input.allowDuplicate) {
      const matches = await this.findDuplicates(organizationId, normalized, input.taxId ?? null);

      if (matches.length > 0) {
        throw new ConflictError(
          'A supplier that looks like this one already exists. Use it, or say explicitly that this is a different company.',
          { details: { matches } },
        );
      }
    }

    const id = newId();

    await this.database.unscoped.$transaction(async (tx) => {
      await tx.vendor.create({
        data: {
          id,
          organizationId,
          name: input.name,
          normalizedName: normalized,
          legalName: input.legalName ?? null,
          taxId: input.taxId ?? null,
          categoryId: input.categoryId ?? null,
          email: input.email ?? null,
          phone: input.phone ?? null,
          website: input.website ?? null,
          addressLine: input.addressLine ?? null,
          city: input.city ?? null,
          postalCode: input.postalCode ?? null,
          countryCode: input.countryCode ?? null,
          defaultCurrency: input.defaultCurrency?.toUpperCase() ?? null,
          paymentTermsDays: input.paymentTermsDays,
          ...this.bankColumns(input.bankDetails),
          notes: input.notes ?? null,
          status: 'ACTIVE',
        },
      });

      await this.audit.record(tx, {
        organizationId,
        action: 'vendor.created',
        resourceType: 'vendor',
        resourceId: id,
        // The bank details are deliberately absent from the audit payload. An
        // audit trail that recorded them would be a second copy of the most
        // sensitive field in the system, in a table built to be read.
        after: {
          name: input.name,
          taxId: input.taxId ?? null,
          ...(input.allowDuplicate ? { createdDespiteMatch: true } : {}),
        },
      });
    });

    return this.get(id);
  }

  async update(id: string, input: UpdateVendor, expectedVersion: number): Promise<VendorRecord> {
    const organizationId = requireOrganization();

    const existing = await this.database.client.vendor.findFirst({ where: { id } });
    if (existing === null) throw new NotFoundError('Vendor');

    guardVersion('Vendor', expectedVersion, existing.version);

    if (existing.status === 'MERGED') {
      throw new ConflictError(
        'This supplier was merged into another one. Edit the one it was merged into.',
      );
    }

    await this.database.unscoped.$transaction(async (tx) => {
      const updated = await tx.vendor.updateMany({
        where: { id, organizationId, version: existing.version },
        data: {
          ...(input.name === undefined
            ? {}
            : { name: input.name, normalizedName: normalizeVendorName(input.name) }),
          ...(input.legalName === undefined ? {} : { legalName: input.legalName }),
          ...(input.taxId === undefined ? {} : { taxId: input.taxId }),
          ...(input.categoryId === undefined ? {} : { categoryId: input.categoryId }),
          ...(input.email === undefined ? {} : { email: input.email }),
          ...(input.phone === undefined ? {} : { phone: input.phone }),
          ...(input.website === undefined ? {} : { website: input.website }),
          ...(input.addressLine === undefined ? {} : { addressLine: input.addressLine }),
          ...(input.city === undefined ? {} : { city: input.city }),
          ...(input.postalCode === undefined ? {} : { postalCode: input.postalCode }),
          ...(input.countryCode === undefined ? {} : { countryCode: input.countryCode }),
          ...(input.defaultCurrency === undefined
            ? {}
            : { defaultCurrency: input.defaultCurrency.toUpperCase() }),
          ...(input.paymentTermsDays === undefined
            ? {}
            : { paymentTermsDays: input.paymentTermsDays }),
          ...(input.notes === undefined ? {} : { notes: input.notes }),
          ...(input.status === undefined ? {} : { status: input.status }),
          ...this.bankColumns(input.bankDetails),
          version: { increment: 1 },
        },
      });

      if (updated.count === 0) throw new ConflictError('The supplier changed. Read it again.');

      await this.audit.record(tx, {
        organizationId,
        action: 'vendor.updated',
        resourceType: 'vendor',
        resourceId: id,
        before: { name: existing.name, status: existing.status },
        after: {
          ...(input.name === undefined ? {} : { name: input.name }),
          ...(input.status === undefined ? {} : { status: input.status }),
          // Recorded as a fact, never as a value.
          ...(input.bankDetails === undefined ? {} : { bankDetailsChanged: true }),
        },
      });
    });

    return this.get(id);
  }

  /**
   * Merge one supplier into another, without deleting either (FR-VND-002).
   *
   * Bills and purchase orders are repointed so reports and payment runs see one
   * supplier, and the loser stays as a tombstone that still resolves.
   */
  async merge(id: string, input: MergeVendor, expectedVersion: number): Promise<VendorRecord> {
    const organizationId = requireOrganization();

    if (id === input.intoVendorId) {
      throw new ValidationError({ intoVendorId: ['A supplier cannot be merged into itself.'] });
    }

    const [loser, winner] = await Promise.all([
      this.database.client.vendor.findFirst({ where: { id } }),
      this.database.client.vendor.findFirst({ where: { id: input.intoVendorId } }),
    ]);

    if (loser === null) throw new NotFoundError('Vendor');
    if (winner === null) {
      throw new ValidationError({ intoVendorId: ['That supplier does not exist.'] });
    }

    guardVersion('Vendor', expectedVersion, loser.version);

    if (winner.status === 'MERGED') {
      throw new ConflictError(
        'That supplier has itself been merged. Merge into the one it points at.',
      );
    }

    await this.database.unscoped.$transaction(async (tx) => {
      const [bills, orders] = await Promise.all([
        tx.bill.updateMany({
          where: { organizationId, vendorId: id },
          data: { vendorId: input.intoVendorId },
        }),
        tx.purchaseOrder.updateMany({
          where: { organizationId, vendorId: id },
          data: { vendorId: input.intoVendorId },
        }),
      ]);

      const updated = await tx.vendor.updateMany({
        where: { id, organizationId, version: loser.version },
        data: {
          status: 'MERGED',
          mergedIntoId: input.intoVendorId,
          version: { increment: 1 },
        },
      });

      if (updated.count === 0) throw new ConflictError('The supplier changed. Read it again.');

      await this.audit.record(tx, {
        organizationId,
        action: 'vendor.merged',
        resourceType: 'vendor',
        resourceId: id,
        before: { name: loser.name, status: loser.status },
        after: { mergedInto: winner.name, mergedIntoId: winner.id },
        metadata: {
          billsMoved: bills.count,
          purchaseOrdersMoved: orders.count,
          ...(input.reason === undefined ? {} : { reason: input.reason }),
        },
      });
    });

    return this.get(input.intoVendorId);
  }

  /** What a create would collide with, named so a person can decide. */
  async findDuplicates(
    organizationId: string,
    normalizedName: string,
    taxId: string | null,
  ): Promise<VendorMatch[]> {
    const rows = await this.database.unscoped.vendor.findMany({
      where: {
        organizationId,
        status: { not: 'MERGED' },
        OR: [
          { normalizedName },
          ...(taxId === null || taxId.trim() === '' ? [] : [{ taxId }]),
        ],
      },
      select: { id: true, name: true, taxId: true, normalizedName: true },
      take: 5,
    });

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      taxId: row.taxId,
      // Tax id is the stronger signal and is reported when it matches, even
      // when the names differ — a rebrand keeps the tax id and changes
      // everything else.
      reason: row.taxId !== null && row.taxId === taxId ? 'SAME_TAX_ID' : 'SAME_NAME',
    }));
  }

  /**
   * Encrypt the bank details, keeping only the last four in the clear.
   *
   * `undefined` leaves what is stored alone: an update that omitted them must
   * not silently erase a supplier's payment instructions.
   */
  private bankColumns(
    details: CreateVendor['bankDetails'],
  ): { bankDetailsEncrypted: string; bankAccountLast4: string } | Record<string, never> {
    if (details === undefined) return {};

    const account = details.iban ?? details.accountNumber;

    return {
      bankDetailsEncrypted: this.crypto.encrypt(JSON.stringify(details)),
      bankAccountLast4: account.slice(-4),
    };
  }
}

interface VendorRow {
  id: string;
  name: string;
  legalName: string | null;
  taxId: string | null;
  categoryId: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  addressLine: string | null;
  city: string | null;
  postalCode: string | null;
  countryCode: string | null;
  defaultCurrency: string | null;
  paymentTermsDays: number;
  bankDetailsEncrypted: string | null;
  bankAccountLast4: string | null;
  status: string;
  mergedIntoId: string | null;
  notes: string | null;
  createdAt: Date;
  version: number;
}

function toRecord(row: VendorRow): VendorRecord {
  return {
    id: row.id,
    name: row.name,
    legalName: row.legalName,
    taxId: row.taxId,
    categoryId: row.categoryId,
    email: row.email,
    phone: row.phone,
    website: row.website,
    addressLine: row.addressLine,
    city: row.city,
    postalCode: row.postalCode,
    countryCode: row.countryCode,
    defaultCurrency: row.defaultCurrency,
    paymentTermsDays: row.paymentTermsDays,
    bankAccountLast4: row.bankAccountLast4,
    // The fact, never the value. There is no code path that returns the
    // ciphertext or the plaintext to a caller.
    hasBankDetails: row.bankDetailsEncrypted !== null,
    status: row.status as VendorRecord['status'],
    mergedIntoId: row.mergedIntoId,
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
    version: row.version,
  };
}

/**
 * The name, reduced to what two people entering the same supplier would agree
 * on.
 *
 * Case, punctuation, and the legal suffix all go: "Acme Ltd.", "ACME Limited",
 * and "acme, ltd" normalise to `acme`. The suffix list is deliberately short —
 * stripping more would merge "Acme Group" into "Acme", which are routinely two
 * different companies and two different bank accounts.
 */
export function normalizeVendorName(name: string): string {
  const suffixes = [
    'ltd',
    'limited',
    'llc',
    'inc',
    'incorporated',
    'plc',
    'gmbh',
    'bv',
    'sa',
    'srl',
    'ab',
    'oy',
    'pty',
    'corp',
    'corporation',
    'co',
  ];

  const words = name
    .toLowerCase()
    .normalize('NFKD')
    .replaceAll(/[^\p{Letter}\p{Number}\s]/gu, ' ')
    .split(/\s+/)
    .filter((word) => word !== '');

  while (words.length > 1 && suffixes.includes(words[words.length - 1] ?? '')) {
    words.pop();
  }

  return words.join(' ');
}

function requireOrganization(): string {
  const organizationId = getOrganizationId();
  if (organizationId === undefined) throw new Error('No organisation in context.');
  return organizationId;
}


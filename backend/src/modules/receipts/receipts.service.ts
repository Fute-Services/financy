import {
  RECEIPT_MAX_BYTES,
  type AttachReceipt,
  type CreateUploadIntent,
  type ListReceiptsQuery,
  type OcrFields,
  type ReceiptDetail,
  type ReceiptRecord,
  type UploadIntent,
} from '@financy/contracts';
import {
  ConflictError,
  FILE_TYPE_HEADER_BYTES,
  NotFoundError,
  ValidationError,
  detectFileType,
  newId,
  stripJpegMetadata,
} from '@financy/core';
import type { Prisma } from '@financy/db';
import { Inject, Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';

import { AuditService } from '../../platform/audit/index.js';
import { ConfigService } from '../../platform/config/index.js';
import { DatabaseService } from '../../platform/database/index.js';
import { DOCUMENT_PROVIDER, type DocumentProvider } from '../../platform/documents/index.js';
import { QUEUE_PORT, type QueuePort } from '../../platform/queue/index.js';
import { callerHas, getContext, getOrganizationId } from '../../platform/request-context/index.js';

/**
 * Receipts (epic 3.1).
 *
 * ## Three steps, and the API never sees the bytes on the way in
 *
 * Intent writes a `PENDING` row and returns a signed URL. The browser PUTs the
 * file straight to storage. Completion reads the stored object back and
 * decides what it is. A 20 MB body through this process would be 20 MB of
 * memory per concurrent upload, and an endpoint that accepts arbitrary files is
 * an endpoint somebody points a fuzzer at.
 *
 * ## Completion disbelieves everything the client said
 *
 * The declared content type is a claim; the file's first bytes are evidence
 * (FR-EXP-004). A mismatch deletes the object and quarantines the row rather
 * than leaving something unidentified in the bucket, because "we noticed and
 * kept it" is a worse outcome than either accepting or refusing cleanly.
 *
 * ## A photograph is scrubbed before anybody can read it
 *
 * A phone photo of a restaurant bill carries GPS coordinates, a device serial,
 * and an exact timestamp. Nobody consented to giving their employer that, and
 * it would otherwise travel into every export and backup (FR-EXP-006).
 */
@Injectable()
export class ReceiptsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
    private readonly logger: PinoLogger,
    @Inject(DOCUMENT_PROVIDER) private readonly documents: DocumentProvider,
    @Inject(QUEUE_PORT) private readonly queue: QueuePort,
  ) {}

  /**
   * Somewhere to put a file.
   *
   * The row is written first and the URL issued second, so a signed URL always
   * names an object this system is expecting. The reverse order would let a
   * URL exist for a receipt that does not, which is an object nothing will
   * ever clean up.
   */
  async createUploadIntent(input: CreateUploadIntent): Promise<UploadIntent> {
    const organizationId = requireOrganization();
    const uploaderMembershipId = requireMembership();

    const receiptId = newId();
    // Generated, never derived from the file name (docs/13 §7). The
    // organisation prefix makes a mis-scoped read visible in the key itself.
    const storageKey = `${organizationId}/${receiptId}`;

    await this.database.unscoped.receipt.create({
      data: {
        id: receiptId,
        organizationId,
        uploaderMembershipId,
        storageKey,
        fileName: input.fileName,
        // What they said it is. Overwritten at completion by what it is.
        contentType: input.contentType,
        byteSize: 0,
        status: 'PENDING',
        scanStatus: 'PENDING',
        ocrStatus: 'PENDING',
        storedAt: null,
        deletedAt: null,
        attachedTargetType: null,
        attachedTargetId: null,
      },
    });

    const ttl = this.config.get('STORAGE_SIGNED_URL_TTL_SECONDS');
    const maxBytes = Math.min(this.config.get('STORAGE_MAX_UPLOAD_BYTES'), RECEIPT_MAX_BYTES);

    const signed = await this.documents.createUploadUrl(
      storageKey,
      input.contentType,
      maxBytes,
      ttl,
    );

    return {
      receiptId,
      uploadUrl: signed.url,
      expiresAt: signed.expiresAt.toISOString(),
      maxBytes,
      provider: this.documents.providerKey,
      // Travels to the screen, so "stored locally, not in a bucket" is
      // something the person can see rather than something they assume.
      isSandbox: this.documents.isSandbox,
    };
  }

  /**
   * The file has landed. Decide whether to keep it.
   *
   * Everything here reads the stored object. Nothing is taken on trust, and
   * the order matters: identify, then measure, then scrub, then record.
   */
  async completeUpload(id: string): Promise<ReceiptDetail> {
    const organizationId = requireOrganization();

    const receipt = await this.database.client.receipt.findFirst({
      where: { id, ...this.visibleToCaller() },
      select: { id: true, storageKey: true, status: true, contentType: true, fileName: true },
    });

    if (receipt === null) throw new NotFoundError('Receipt');

    if (receipt.status !== 'PENDING') {
      throw new ConflictError('This receipt has already been completed.');
    }

    const metadata = await this.documents.getObjectMetadata(receipt.storageKey);

    if (metadata === null) {
      // Nothing was uploaded. Not an error state to store — the row stays
      // `PENDING`, which is exactly what it is.
      throw new ValidationError({
        file: ['No file has been uploaded yet. Upload it to the link first, then complete.'],
      });
    }

    if (metadata.byteSize > RECEIPT_MAX_BYTES) {
      await this.quarantine(receipt.id, receipt.storageKey, 'TOO_LARGE');

      throw new ValidationError({
        file: [`That file is larger than the ${String(RECEIPT_MAX_BYTES / 1024 / 1024)} MB limit.`],
      });
    }

    const header = await this.documents.readHeader(receipt.storageKey, FILE_TYPE_HEADER_BYTES);
    const detected = header === null ? null : detectFileType(header);

    if (detected === null || detected !== receipt.contentType) {
      /**
       * The requirement's own test: an executable renamed `.pdf`.
       *
       * The object is deleted rather than kept for inspection. A quarantined
       * *row* is a record somebody can act on; a quarantined *file* is an
       * unidentified binary in the bucket, and the only thing worse than
       * refusing it is keeping it.
       */
      await this.quarantine(receipt.id, receipt.storageKey, 'TYPE_MISMATCH');

      this.logger.warn(
        { receiptId: receipt.id, declared: receipt.contentType, detected },
        'A receipt was refused: its contents are not what it claimed to be.',
      );

      throw new ValidationError({
        file: ['That file is not the kind of file it claims to be, so it was not stored.'],
      });
    }

    let byteSize = metadata.byteSize;
    let checksum = metadata.checksum;

    if (detected === 'image/jpeg') {
      const original = await this.documents.read(receipt.storageKey);

      if (original !== null) {
        const scrubbed = stripJpegMetadata(original);

        if (scrubbed.byteLength !== original.byteLength) {
          await this.documents.replaceObject(receipt.storageKey, scrubbed);

          const after = await this.documents.getObjectMetadata(receipt.storageKey);
          byteSize = after?.byteSize ?? scrubbed.byteLength;
          checksum = after?.checksum ?? checksum;
        }
      }
    }

    await this.database.unscoped.$transaction(async (tx) => {
      await tx.receipt.update({
        where: { id: receipt.id },
        data: {
          status: 'STORED',
          contentType: detected,
          byteSize,
          checksum,
          storedAt: new Date(),
        },
      });

      await this.audit.record(tx, {
        action: 'receipt.uploaded',
        resourceType: 'receipt',
        resourceId: receipt.id,
        after: { fileName: receipt.fileName, contentType: detected, byteSize },
      });
    });

    // After the commit (docs/14 §1). Neither job changes what was stored, and
    // both are allowed to be late.
    await this.queue.enqueue(
      'receipt.scan',
      { organizationId, receiptId: receipt.id },
      { idempotencyKey: `receipt:${receipt.id}:scan` },
    );

    await this.queue.enqueue(
      'receipt.ocr',
      { organizationId, receiptId: receipt.id },
      { idempotencyKey: `receipt:${receipt.id}:ocr` },
    );

    return this.get(receipt.id);
  }

  async list(query: ListReceiptsQuery): Promise<{ items: ReceiptRecord[]; total: number }> {
    const where = {
      ...(query.status === undefined ? {} : { status: query.status }),
      ...(query.unattached === true ? { attachedTargetId: null } : {}),
      deletedAt: null,
      ...this.visibleToCaller(query.mine === true),
    };

    const [total, rows] = await Promise.all([
      this.database.client.receipt.count({ where }),
      this.database.client.receipt.findMany({
        where,
        select: SELECT,
        orderBy: [{ createdAt: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);

    return { total, items: rows.map(toRecord) };
  }

  /**
   * One receipt, with a link that is issued now and expires soon.
   *
   * The URL is minted per read, after this query has proved the caller may see
   * the row (FR-EXP-005). Storing a URL on the record would make it outlive
   * the permission that produced it, which is the whole failure the signed-URL
   * pattern exists to avoid.
   */
  async get(id: string): Promise<ReceiptDetail> {
    const organizationId = requireOrganization();

    const receipt = await this.database.client.receipt.findFirst({
      where: { id, ...this.visibleToCaller() },
      select: { ...SELECT, storageKey: true },
    });

    if (receipt === null) throw new NotFoundError('Receipt');

    const history = await this.database.unscoped.receiptAttachment.findMany({
      where: { organizationId, receiptId: id },
      select: {
        id: true,
        targetType: true,
        targetId: true,
        attachedAt: true,
        detachedAt: true,
        attachedBy: { select: { user: { select: { fullName: true } } } },
        detachedBy: { select: { user: { select: { fullName: true } } } },
      },
      orderBy: [{ attachedAt: 'desc' }],
    });

    const download =
      receipt.status === 'STORED'
        ? await this.documents.createDownloadUrl(
            receipt.storageKey,
            // Fifteen minutes at most (docs/13 §7). Long enough to open the
            // file, short enough that a pasted link is useless by the time
            // anybody else reads it.
            Math.min(this.config.get('STORAGE_SIGNED_URL_TTL_SECONDS'), 900),
            receipt.fileName,
          )
        : null;

    return {
      ...toRecord(receipt),
      history: history.map((row) => ({
        id: row.id,
        targetType: row.targetType as 'transaction' | 'expense',
        targetId: row.targetId,
        attachedBy: row.attachedBy.user.fullName,
        attachedAt: row.attachedAt.toISOString(),
        detachedAt: row.detachedAt?.toISOString() ?? null,
        detachedBy: row.detachedBy?.user.fullName ?? null,
      })),
      downloadUrl: download?.url ?? null,
      downloadExpiresAt: download?.expiresAt.toISOString() ?? null,
    };
  }

  /**
   * Attach a receipt to one thing.
   *
   * **One open attachment at a time** (FR-EXP-007). The same image on two
   * expenses is the mechanism for claiming one lunch twice, so moving a
   * receipt closes the previous attachment rather than adding a second — and
   * the closed row stays, because "it used to be on that one" is the question
   * an auditor asks.
   */
  async attach(id: string, input: AttachReceipt): Promise<ReceiptDetail> {
    const organizationId = requireOrganization();
    const membershipId = requireMembership();

    await this.database.unscoped.$transaction(async (tx) => {
      const receipt = await tx.receipt.findFirst({
        where: { id, organizationId, deletedAt: null },
        select: { id: true, status: true, attachedTargetId: true, attachedTargetType: true },
      });

      if (receipt === null) throw new NotFoundError('Receipt');

      if (receipt.status !== 'STORED') {
        throw new ConflictError('Only a stored receipt can be attached to anything.');
      }

      // The target has to exist and be ours. A receipt attached to another
      // organisation's expense would be a cross-tenant reference the database
      // can no longer refuse (ADR-0017).
      await this.assertTargetIsOurs(tx, organizationId, input.targetType, input.targetId);

      if (
        receipt.attachedTargetId === input.targetId &&
        receipt.attachedTargetType === input.targetType
      ) {
        return;
      }

      await tx.receiptAttachment.updateMany({
        where: { organizationId, receiptId: id, detachedAt: null },
        data: { detachedAt: new Date(), detachedByMembershipId: membershipId },
      });

      await tx.receiptAttachment.create({
        data: {
          id: newId(),
          organizationId,
          receiptId: id,
          targetType: input.targetType,
          targetId: input.targetId,
          attachedByMembershipId: membershipId,
          detachedAt: null,
        },
      });

      await tx.receipt.update({
        where: { id },
        data: { attachedTargetType: input.targetType, attachedTargetId: input.targetId },
      });

      if (input.targetType === 'transaction') {
        // The charge's receipt axis moves with it, which is what makes the
        // finance queue's "still needs a receipt" filter mean anything.
        await tx.transaction.updateMany({
          where: { id: input.targetId, organizationId },
          data: { receiptStatus: 'ATTACHED' },
        });
      }

      await this.audit.record(tx, {
        action: 'receipt.attached',
        resourceType: 'receipt',
        resourceId: id,
        after: { targetType: input.targetType, targetId: input.targetId },
      });
    });

    return this.get(id);
  }

  async detach(id: string): Promise<ReceiptDetail> {
    const organizationId = requireOrganization();
    const membershipId = requireMembership();

    await this.database.unscoped.$transaction(async (tx) => {
      const receipt = await tx.receipt.findFirst({
        where: { id, organizationId, deletedAt: null },
        select: { id: true, attachedTargetType: true, attachedTargetId: true },
      });

      if (receipt === null) throw new NotFoundError('Receipt');
      if (receipt.attachedTargetId === null) return;

      await tx.receiptAttachment.updateMany({
        where: { organizationId, receiptId: id, detachedAt: null },
        data: { detachedAt: new Date(), detachedByMembershipId: membershipId },
      });

      await tx.receipt.update({
        where: { id },
        data: { attachedTargetType: null, attachedTargetId: null },
      });

      if (receipt.attachedTargetType === 'transaction') {
        await tx.transaction.updateMany({
          where: { id: receipt.attachedTargetId, organizationId },
          data: { receiptStatus: 'MISSING' },
        });
      }

      await this.audit.record(tx, {
        action: 'receipt.detached',
        resourceType: 'receipt',
        resourceId: id,
        before: { targetType: receipt.attachedTargetType, targetId: receipt.attachedTargetId },
      });
    });

    return this.get(id);
  }

  /** Called by the scan job. Separate from the OCR result on purpose. */
  async recordScan(receiptId: string, status: 'CLEAN' | 'INFECTED' | 'SKIPPED'): Promise<void> {
    await this.database.unscoped.receipt.updateMany({
      where: { id: receiptId },
      data: {
        scanStatus: status,
        // An infected file is not merely flagged. It stops being readable,
        // because a "quarantined" file anybody can still download is a
        // quarantine in name only.
        ...(status === 'INFECTED' ? { status: 'QUARANTINED' } : {}),
      },
    });
  }

  /** Called by the OCR job. Suggestions, never a source of truth. */
  async recordOcr(receiptId: string, fields: OcrFields | null): Promise<void> {
    await this.database.unscoped.receipt.updateMany({
      where: { id: receiptId },
      data: {
        ocrStatus: fields === null ? 'SKIPPED' : 'DONE',
        ocrFields: (fields ?? null) as never,
      },
    });
  }

  // ── internals ────────────────────────────────────────────────────────────

  private async quarantine(id: string, storageKey: string, reason: string): Promise<void> {
    await this.documents.deleteObject(storageKey);

    await this.database.unscoped.$transaction(async (tx) => {
      await tx.receipt.update({
        where: { id },
        data: { status: 'QUARANTINED', scanStatus: 'FAILED' },
      });

      await this.audit.record(tx, {
        action: 'receipt.quarantined',
        resourceType: 'receipt',
        resourceId: id,
        metadata: { reason },
      });
    });
  }

  /**
   * The target exists and belongs to this organisation.
   *
   * MongoDB cannot refuse a cross-tenant reference (ADR-0017), so this check
   * is what stops a receipt being attached to another company's charge. It
   * takes one target type today; `expense` joins the union with Epic 3.2, and
   * the exhaustive switch is what will make forgetting this branch a compile
   * error rather than an attachment nobody validated.
   */
  private async assertTargetIsOurs(
    tx: Prisma.TransactionClient,
    organizationId: string,
    targetType: 'transaction' | 'expense',
    targetId: string,
  ): Promise<void> {
    switch (targetType) {
      case 'transaction': {
        const transaction = await tx.transaction.findFirst({
          where: { id: targetId, organizationId },
          select: { id: true },
        });

        if (transaction === null) throw new NotFoundError('Transaction');
        return;
      }

      case 'expense': {
        const expense = await tx.expense.findFirst({
          where: { id: targetId, organizationId },
          select: { id: true, status: true },
        });

        if (expense === null) throw new NotFoundError('Expense');

        // Attaching evidence to a settled claim would change what an approver
        // agreed to after they agreed to it.
        if (expense.status !== 'DRAFT' && expense.status !== 'CHANGES_REQUESTED') {
          throw new ConflictError(
            'That expense has been submitted. Receipts can only be attached while it is a draft.',
          );
        }

        return;
      }
    }
  }

  /**
   * What this caller may see.
   *
   * Somebody without `receipt:read_all` sees the receipts they uploaded. A
   * receipt is a photograph of somebody's lunch, their taxi, and sometimes
   * their medical appointment — the default is their own, and seeing
   * everybody's is a finance power rather than an ordinary one.
   */
  private visibleToCaller(mine = false): { uploaderMembershipId?: string } {
    const membershipId = getContext()?.membershipId;

    if (membershipId === undefined) return {};
    if (callerHas('receipt:read_all') && !mine) return {};

    return { uploaderMembershipId: membershipId };
  }
}

const SELECT = {
  id: true,
  fileName: true,
  contentType: true,
  byteSize: true,
  status: true,
  scanStatus: true,
  ocrStatus: true,
  ocrFields: true,
  attachedTargetType: true,
  attachedTargetId: true,
  createdAt: true,
  storedAt: true,
  uploaderMembershipId: true,
  uploader: { select: { user: { select: { fullName: true } } } },
} as const;

interface Row {
  id: string;
  fileName: string;
  contentType: string;
  byteSize: number;
  status: string;
  scanStatus: string;
  ocrStatus: string;
  ocrFields: unknown;
  attachedTargetType: string | null;
  attachedTargetId: string | null;
  createdAt: Date;
  storedAt: Date | null;
  uploaderMembershipId: string;
  uploader: { user: { fullName: string } };
}

function toRecord(row: Row): ReceiptRecord {
  return {
    id: row.id,
    fileName: row.fileName,
    contentType: row.contentType,
    byteSize: row.byteSize,
    status: row.status as ReceiptRecord['status'],
    scanStatus: row.scanStatus as ReceiptRecord['scanStatus'],
    ocrStatus: row.ocrStatus as ReceiptRecord['ocrStatus'],
    ocr: (row.ocrFields ?? null) as ReceiptRecord['ocr'],
    uploadedBy: { membershipId: row.uploaderMembershipId, fullName: row.uploader.user.fullName },
    attachedTo:
      row.attachedTargetId === null || row.attachedTargetType === null
        ? null
        : {
            targetType: row.attachedTargetType as 'transaction' | 'expense',
            targetId: row.attachedTargetId,
          },
    createdAt: row.createdAt.toISOString(),
    storedAt: row.storedAt?.toISOString() ?? null,
  };
}

function requireOrganization(): string {
  const organizationId = getOrganizationId();

  if (organizationId === undefined) {
    throw new Error('Receipts cannot be read or written without a tenant context.');
  }

  return organizationId;
}

function requireMembership(): string {
  const membershipId = getContext()?.membershipId;

  if (membershipId === undefined) {
    throw new Error('A receipt must name the membership that uploaded it.');
  }

  return membershipId;
}

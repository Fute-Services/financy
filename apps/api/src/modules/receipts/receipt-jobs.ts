import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';

import { DatabaseService } from '../../platform/database/index.js';
import { DOCUMENT_PROVIDER, type DocumentProvider } from '../../platform/documents/index.js';
import { JobRegistry, PermanentJobError, type JobPayload } from '../../platform/queue/index.js';
import { OCR_PROVIDER, type OcrProvider } from './ocr-provider.js';
import { ReceiptsService } from './receipts.service.js';

/**
 * What happens to a receipt after it lands (epic 3.1).
 *
 * Both jobs are deliberately *after* storage and outside the request. Neither
 * changes what was stored, and neither may block somebody filing an expense —
 * a scanner that is down or an OCR service that is slow must cost a status
 * field, not a submission (FR-EXP-011).
 */
@Injectable()
export class ReceiptJobs implements OnModuleInit {
  constructor(
    private readonly database: DatabaseService,
    private readonly receipts: ReceiptsService,
    private readonly registry: JobRegistry,
    private readonly logger: PinoLogger,
    @Inject(DOCUMENT_PROVIDER) private readonly documents: DocumentProvider,
    @Inject(OCR_PROVIDER) private readonly ocr: OcrProvider,
  ) {}

  onModuleInit(): void {
    this.registry.register('receipt.scan', (payload) => this.scan(payload));
    this.registry.register('receipt.ocr', (payload) => this.extract(payload));
  }

  /**
   * Malware scanning, which this build does not do.
   *
   * **`SKIPPED`, never `CLEAN`.** There is no scanner configured, and a status
   * saying a file is clean when nothing examined it is the single most
   * dangerous lie this system could tell — somebody would rely on it. The
   * status names the absence, the screen can show it, and wiring a real
   * scanner is a change to this method and nothing else.
   */
  private async scan(payload: JobPayload<'receipt.scan'>): Promise<void> {
    const receipt = await this.database.unscoped.receipt.findFirst({
      where: { id: payload.receiptId, organizationId: payload.organizationId },
      select: { id: true, status: true },
    });

    if (receipt === null) {
      throw new PermanentJobError(`Receipt ${payload.receiptId} no longer exists.`);
    }

    // Deleted or quarantined between the upload and this job. Nothing to do,
    // and not a failure.
    if (receipt.status !== 'STORED') return;

    await this.receipts.recordScan(receipt.id, 'SKIPPED');

    this.logger.debug(
      { receiptId: receipt.id },
      'Receipt scan skipped: no malware scanner is configured.',
    );
  }

  /**
   * Extract what the receipt says, as suggestions.
   *
   * A failure here is recorded and swallowed: a receipt whose OCR failed is a
   * receipt, and the person filing the expense types the amount themselves —
   * which is what they would do anyway with the no-op adapter.
   */
  private async extract(payload: JobPayload<'receipt.ocr'>): Promise<void> {
    const receipt = await this.database.unscoped.receipt.findFirst({
      where: { id: payload.receiptId, organizationId: payload.organizationId },
      select: { id: true, status: true, contentType: true, storageKey: true },
    });

    if (receipt === null) {
      throw new PermanentJobError(`Receipt ${payload.receiptId} no longer exists.`);
    }

    if (receipt.status !== 'STORED') return;

    const data = await this.documents.read(receipt.storageKey);

    if (data === null) {
      await this.receipts.recordOcr(receipt.id, null);
      return;
    }

    const fields = await this.ocr.extract(receipt.id, receipt.contentType, data);

    await this.receipts.recordOcr(receipt.id, fields);
  }
}

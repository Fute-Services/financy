import { Module } from '@nestjs/common';

import { DocumentsController } from './documents.controller.js';
import { NoOpOcrProvider, OCR_PROVIDER } from './ocr-provider.js';
import { ReceiptJobs } from './receipt-jobs.js';
import { ReceiptsController } from './receipts.controller.js';
import { ReceiptsService } from './receipts.service.js';

/**
 * Receipts, and the storage route their signed URLs point at.
 *
 * `DocumentsController` lives here rather than in the platform layer, and that
 * is a judgement worth stating: the platform holds the *port*, and a route is
 * a piece of product surface — it has a URL, a status code, and a
 * `Content-Disposition` header that exists for a reason. Putting an HTTP
 * endpoint in `platform/` would be the first one, and the next would be a
 * controller that reaches for the database.
 */
@Module({
  controllers: [ReceiptsController, DocumentsController],
  providers: [ReceiptsService, ReceiptJobs, { provide: OCR_PROVIDER, useClass: NoOpOcrProvider }],
  exports: [ReceiptsService],
})
export class ReceiptsModule {}

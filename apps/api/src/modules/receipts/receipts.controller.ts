import {
  attachReceiptSchema,
  createUploadIntentSchema,
  listReceiptsQuerySchema,
  type AttachReceipt,
  type CreateUploadIntent,
  type ListReceiptsQuery,
  type OffsetCollection,
  type ReceiptDetail,
  type ReceiptRecord,
  type Resource,
  type UploadIntent,
} from '@financy/contracts';
import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query } from '@nestjs/common';

import { RequirePermission } from '../../platform/authorization/index.js';
import { getCorrelationId } from '../../platform/request-context/index.js';
import { ZodValidationPipe } from '../../platform/validation/index.js';
import { ReceiptsService } from './receipts.service.js';

/**
 * `/v1/receipts` (docs/10 §5.9, epic 3.1).
 *
 * **No route here accepts a file.** The bytes go straight to storage under a
 * signed URL and come back through a signed URL; this controller deals only in
 * intents, completions, and attachments. An API that accepted uploads would
 * hold 20 MB per concurrent request and would be the obvious thing to point a
 * fuzzer at.
 *
 * **There is no `PATCH`.** A receipt is a file somebody uploaded; its name,
 * its type, and its bytes are what they are. What changes is where it is
 * attached, and that has its own route with its own history.
 */
@Controller('receipts')
export class ReceiptsController {
  constructor(private readonly receipts: ReceiptsService) {}

  @Get()
  @RequirePermission('receipt:read')
  async list(
    @Query(new ZodValidationPipe(listReceiptsQuerySchema)) query: ListReceiptsQuery,
  ): Promise<OffsetCollection<ReceiptRecord>> {
    const { items, total } = await this.receipts.list(query);

    return {
      data: items,
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        totalCount: total,
        totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
      },
      meta: { correlationId: getCorrelationId() },
    };
  }

  /**
   * Ask for somewhere to put a file.
   *
   * Declared before `:id`, or `upload-intent` would be read as a receipt id.
   */
  @Post('upload-intent')
  @RequirePermission('receipt:upload')
  async intent(
    @Body(new ZodValidationPipe(createUploadIntentSchema)) body: CreateUploadIntent,
  ): Promise<Resource<UploadIntent>> {
    return {
      data: await this.receipts.createUploadIntent(body),
      meta: { correlationId: getCorrelationId() },
    };
  }

  @Get(':id')
  @RequirePermission('receipt:read')
  async get(@Param('id') id: string): Promise<Resource<ReceiptDetail>> {
    return { data: await this.receipts.get(id), meta: { correlationId: getCorrelationId() } };
  }

  /**
   * The file has been uploaded; check it and keep it.
   *
   * A `POST` with an empty body, which looks odd and is right: everything that
   * decides the outcome is read from the stored object, and a body carrying
   * the file's size or type would be a body carrying a claim.
   */
  @Post(':id/complete')
  @HttpCode(200)
  @RequirePermission('receipt:upload')
  async complete(@Param('id') id: string): Promise<Resource<ReceiptDetail>> {
    return {
      data: await this.receipts.completeUpload(id),
      meta: { correlationId: getCorrelationId() },
    };
  }

  @Post(':id/attach')
  @HttpCode(200)
  @RequirePermission('receipt:upload')
  async attach(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(attachReceiptSchema)) body: AttachReceipt,
  ): Promise<Resource<ReceiptDetail>> {
    return {
      data: await this.receipts.attach(id, body),
      meta: { correlationId: getCorrelationId() },
    };
  }

  /**
   * Detach, which is not delete.
   *
   * The receipt stays and the attachment history keeps the row that says where
   * it used to be — "this used to be on another expense" is exactly the
   * question an auditor asks (FR-EXP-007).
   */
  @Delete(':id/attach')
  @HttpCode(200)
  @RequirePermission('receipt:upload')
  async detach(@Param('id') id: string): Promise<Resource<ReceiptDetail>> {
    return { data: await this.receipts.detach(id), meta: { correlationId: getCorrelationId() } };
  }
}

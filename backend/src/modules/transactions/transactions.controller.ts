import {
  bulkReviewSchema,
  categorizeTransactionSchema,
  createAdjustmentSchema,
  importTransactionsSchema,
  listTransactionsQuerySchema,
  matchTransactionSchema,
  reviewTransactionSchema,
  type BulkReview,
  type BulkReviewResult,
  type CategorizeTransaction,
  type CreateAdjustment,
  type ImportResult,
  type ImportTransactions,
  type ListTransactionsQuery,
  type MatchTransaction,
  type OffsetCollection,
  type Resource,
  type ReviewTransaction,
  type TransactionDetail,
  type TransactionRecord,
} from '@financy/contracts';
import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';

import { RequirePermission } from '../../platform/authorization/index.js';
import { IfMatch } from '../../platform/concurrency/index.js';
import { getCorrelationId } from '../../platform/request-context/index.js';
import { ZodValidationPipe } from '../../platform/validation/index.js';
import { TransactionsService } from './transactions.service.js';

/**
 * `/v1/transactions` (docs/10 §5.8).
 *
 * **There is no `POST /transactions` and no `DELETE`.** A transaction is a
 * record of money that moved; it arrives from a provider or an import, and it
 * is never created by somebody typing one in, nor removed when it becomes
 * inconvenient. A correction is `POST :id/adjustments`, which writes a new
 * linked row and leaves the original intact.
 *
 * **Coding, reviewing, and matching are three routes with three permissions.**
 * They are three jobs done by different people: a cardholder codes their own
 * charges, finance reviews them, and matching a charge to its authorisation is
 * part of reconciliation. One `transaction:update` covering all three would
 * mean granting review authority to let somebody pick a category.
 *
 * **Import takes JSON rows, not a file.** Parsing CSV belongs at the edge —
 * the web app reads the file, shows the person what it found, lets them map the
 * columns, and posts structured rows. An endpoint that took a file would have
 * to guess at delimiters and encodings with nobody to ask, and would report its
 * guesses as import failures.
 */
@Controller('transactions')
export class TransactionsController {
  constructor(private readonly transactions: TransactionsService) {}

  @Get()
  @RequirePermission('transaction:read')
  async list(
    @Query(new ZodValidationPipe(listTransactionsQuerySchema)) query: ListTransactionsQuery,
  ): Promise<OffsetCollection<TransactionRecord>> {
    const { items, total } = await this.transactions.list(query);

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
   * Declared before `:id`. Nest matches in declaration order, and `import`
   * would otherwise be read as a transaction id and answer 404 for every call.
   */
  @Post('import')
  @HttpCode(200)
  @RequirePermission('transaction:import')
  async import(
    @Body(new ZodValidationPipe(importTransactionsSchema)) body: ImportTransactions,
  ): Promise<Resource<ImportResult>> {
    return {
      data: await this.transactions.import(body),
      meta: { correlationId: getCorrelationId() },
    };
  }

  /**
   * Review a batch of them.
   *
   * Declared before `:id` for the same reason `import` is: otherwise
   * `bulk-review` is read as a transaction id and answers 404 for every call.
   */
  @Post('bulk-review')
  @HttpCode(200)
  @RequirePermission('transaction:review')
  async bulkReview(
    @Body(new ZodValidationPipe(bulkReviewSchema)) body: BulkReview,
  ): Promise<Resource<BulkReviewResult>> {
    return {
      data: await this.transactions.bulkReview(body),
      meta: { correlationId: getCorrelationId() },
    };
  }

  @Get(':id')
  @RequirePermission('transaction:read')
  async get(@Param('id') id: string): Promise<Resource<TransactionDetail>> {
    return { data: await this.transactions.get(id), meta: { correlationId: getCorrelationId() } };
  }

  @Patch(':id')
  @RequirePermission('transaction:categorize')
  async categorize(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(categorizeTransactionSchema)) body: CategorizeTransaction,
    @IfMatch() version: number,
  ): Promise<Resource<TransactionDetail>> {
    return {
      data: await this.transactions.categorize(id, body, version),
      meta: { correlationId: getCorrelationId() },
    };
  }

  @Post(':id/review')
  @HttpCode(200)
  @RequirePermission('transaction:review')
  async review(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(reviewTransactionSchema)) body: ReviewTransaction,
    @IfMatch() version: number,
  ): Promise<Resource<TransactionDetail>> {
    return {
      data: await this.transactions.review(id, body, version),
      meta: { correlationId: getCorrelationId() },
    };
  }

  @Post(':id/match')
  @HttpCode(200)
  @RequirePermission('transaction:review')
  async match(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(matchTransactionSchema)) body: MatchTransaction,
    @IfMatch() version: number,
  ): Promise<Resource<TransactionDetail>> {
    return {
      data: await this.transactions.match(id, body, version),
      meta: { correlationId: getCorrelationId() },
    };
  }

  /**
   * A correction, as a new row.
   *
   * No `If-Match`: this appends rather than modifying, so there is no version
   * of the transaction that a concurrent write could invalidate. Two people
   * recording the same refund produce two adjustment rows, which is visible and
   * correctable — unlike a lost update, which is neither.
   */
  @Post(':id/adjustments')
  @RequirePermission('transaction:review')
  async adjust(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(createAdjustmentSchema)) body: CreateAdjustment,
  ): Promise<Resource<TransactionDetail>> {
    return {
      data: await this.transactions.adjust(id, body),
      meta: { correlationId: getCorrelationId() },
    };
  }
}

import {
  createBillSchema,
  createCreditNoteSchema,
  createPurchaseOrderSchema,
  createVendorSchema,
  listBillsQuerySchema,
  listPurchaseOrdersQuerySchema,
  listVendorsQuerySchema,
  markBillPaidSchema,
  mergeVendorSchema,
  receivePurchaseOrderSchema,
  updateBillSchema,
  updatePurchaseOrderSchema,
  updateVendorSchema,
  type BillDetail,
  type BillRecord,
  type CreateBill,
  type CreateCreditNote,
  type CreatePurchaseOrder,
  type CreateVendor,
  type ListBillsQuery,
  type ListPurchaseOrdersQuery,
  type ListVendorsQuery,
  type MarkBillPaid,
  type MergeVendor,
  type OffsetCollection,
  type PurchaseOrderDetail,
  type PurchaseOrderRecord,
  type ReceivePurchaseOrder,
  type Resource,
  type UpdateBill,
  type UpdatePurchaseOrder,
  type UpdateVendor,
  type VendorRecord,
} from '@financy/contracts';
import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';

import { RequirePermission } from '../../platform/authorization/index.js';
import { IfMatch } from '../../platform/concurrency/index.js';
import { getCorrelationId } from '../../platform/request-context/index.js';
import { ZodValidationPipe } from '../../platform/validation/index.js';
import { BillsService } from './bills.service.js';
import { PurchaseOrdersService } from './purchase-orders.service.js';
import { VendorsService } from './vendors.service.js';

function paginate<T>(
  items: T[],
  total: number,
  page: number,
  pageSize: number,
): OffsetCollection<T> {
  return {
    data: items,
    pagination: {
      page,
      pageSize,
      totalCount: total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    },
    meta: { correlationId: getCorrelationId() },
  };
}

/**
 * `/v1/vendors` (docs/10 §5.14, epic 5.1).
 *
 * **There is no route that returns bank details.** They are accepted on write,
 * encrypted at rest, and represented in every response by their last four
 * digits. An endpoint that returned them — even to an administrator, even
 * once — would make a read-only foothold worth a payment run.
 *
 * **There is no delete.** A supplier is made inactive or merged; a deleted one
 * orphans every invoice that ever referenced it.
 */
@Controller('vendors')
export class VendorsController {
  constructor(private readonly vendors: VendorsService) {}

  @Get()
  @RequirePermission('vendor:read')
  async list(
    @Query(new ZodValidationPipe(listVendorsQuerySchema)) query: ListVendorsQuery,
  ): Promise<OffsetCollection<VendorRecord>> {
    const { items, total } = await this.vendors.list(query);

    return paginate(items, total, query.page, query.pageSize);
  }

  @Get(':id')
  @RequirePermission('vendor:read')
  async get(@Param('id') id: string): Promise<Resource<VendorRecord>> {
    return { data: await this.vendors.get(id), meta: { correlationId: getCorrelationId() } };
  }

  @Post()
  @RequirePermission('vendor:manage')
  async create(
    @Body(new ZodValidationPipe(createVendorSchema)) body: CreateVendor,
  ): Promise<Resource<VendorRecord>> {
    return { data: await this.vendors.create(body), meta: { correlationId: getCorrelationId() } };
  }

  @Patch(':id')
  @RequirePermission('vendor:manage')
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateVendorSchema)) body: UpdateVendor,
    @IfMatch() version: number,
  ): Promise<Resource<VendorRecord>> {
    return {
      data: await this.vendors.update(id, body, version),
      meta: { correlationId: getCorrelationId() },
    };
  }

  /** Returns the **surviving** supplier, which is what the caller now works with. */
  @Post(':id/merge')
  @HttpCode(200)
  @RequirePermission('vendor:manage')
  async merge(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(mergeVendorSchema)) body: MergeVendor,
    @IfMatch() version: number,
  ): Promise<Resource<VendorRecord>> {
    return {
      data: await this.vendors.merge(id, body, version),
      meta: { correlationId: getCorrelationId() },
    };
  }
}

/**
 * `/v1/bills` (docs/10 §5.15, epic 5.2).
 *
 * **Approving happens on `/v1/approvals`.** A bill is the third subject type
 * the approval machinery serves and nothing about that endpoint changes for it.
 */
@Controller('bills')
export class BillsController {
  constructor(private readonly bills: BillsService) {}

  @Get()
  @RequirePermission('bill:read')
  async list(
    @Query(new ZodValidationPipe(listBillsQuerySchema)) query: ListBillsQuery,
  ): Promise<OffsetCollection<BillRecord>> {
    const { items, total } = await this.bills.list(query);

    return paginate(items, total, query.page, query.pageSize);
  }

  @Get(':id')
  @RequirePermission('bill:read')
  async get(@Param('id') id: string): Promise<Resource<BillDetail>> {
    return { data: await this.bills.get(id), meta: { correlationId: getCorrelationId() } };
  }

  @Post()
  @RequirePermission('bill:create')
  async create(
    @Body(new ZodValidationPipe(createBillSchema)) body: CreateBill,
  ): Promise<Resource<BillDetail>> {
    return { data: await this.bills.create(body), meta: { correlationId: getCorrelationId() } };
  }

  @Patch(':id')
  @RequirePermission('bill:create')
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateBillSchema)) body: UpdateBill,
    @IfMatch() version: number,
  ): Promise<Resource<BillDetail>> {
    return {
      data: await this.bills.update(id, body, version),
      meta: { correlationId: getCorrelationId() },
    };
  }

  @Post(':id/submit')
  @HttpCode(200)
  @RequirePermission('bill:create')
  async submit(
    @Param('id') id: string,
    @IfMatch() version: number,
  ): Promise<Resource<BillDetail>> {
    return {
      data: await this.bills.submit(id, version),
      meta: { correlationId: getCorrelationId() },
    };
  }

  @Post(':id/pay')
  @HttpCode(200)
  @RequirePermission('bill:mark_paid')
  async markPaid(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(markBillPaidSchema)) body: MarkBillPaid,
    @IfMatch() version: number,
  ): Promise<Resource<BillDetail>> {
    return {
      data: await this.bills.markPaid(id, body, version),
      meta: { correlationId: getCorrelationId() },
    };
  }

  /** The correction path for a paid bill, whose own amounts never change. */
  @Post(':id/credit-note')
  @RequirePermission('bill:create')
  async creditNote(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(createCreditNoteSchema)) body: CreateCreditNote,
    @IfMatch() version: number,
  ): Promise<Resource<BillDetail>> {
    return {
      data: await this.bills.creditNote(id, body, version),
      meta: { correlationId: getCorrelationId() },
    };
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @RequirePermission('bill:create')
  async cancel(
    @Param('id') id: string,
    @IfMatch() version: number,
  ): Promise<Resource<BillDetail>> {
    return {
      data: await this.bills.cancel(id, version),
      meta: { correlationId: getCorrelationId() },
    };
  }
}

/** `/v1/purchase-orders` (docs/10 §5.16, epic 5.3). */
@Controller('purchase-orders')
export class PurchaseOrdersController {
  constructor(private readonly orders: PurchaseOrdersService) {}

  @Get()
  @RequirePermission('purchase_order:read')
  async list(
    @Query(new ZodValidationPipe(listPurchaseOrdersQuerySchema)) query: ListPurchaseOrdersQuery,
  ): Promise<OffsetCollection<PurchaseOrderRecord>> {
    const { items, total } = await this.orders.list(query);

    return paginate(items, total, query.page, query.pageSize);
  }

  @Get(':id')
  @RequirePermission('purchase_order:read')
  async get(@Param('id') id: string): Promise<Resource<PurchaseOrderDetail>> {
    return { data: await this.orders.get(id), meta: { correlationId: getCorrelationId() } };
  }

  @Post()
  @RequirePermission('purchase_order:create')
  async create(
    @Body(new ZodValidationPipe(createPurchaseOrderSchema)) body: CreatePurchaseOrder,
  ): Promise<Resource<PurchaseOrderDetail>> {
    return { data: await this.orders.create(body), meta: { correlationId: getCorrelationId() } };
  }

  @Patch(':id')
  @RequirePermission('purchase_order:create')
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updatePurchaseOrderSchema)) body: UpdatePurchaseOrder,
    @IfMatch() version: number,
  ): Promise<Resource<PurchaseOrderDetail>> {
    return {
      data: await this.orders.update(id, body, version),
      meta: { correlationId: getCorrelationId() },
    };
  }

  @Post(':id/submit')
  @HttpCode(200)
  @RequirePermission('purchase_order:create')
  async submit(
    @Param('id') id: string,
    @IfMatch() version: number,
  ): Promise<Resource<PurchaseOrderDetail>> {
    return {
      data: await this.orders.submit(id, version),
      meta: { correlationId: getCorrelationId() },
    };
  }

  /**
   * Recording a delivery.
   *
   * Its own permission: the person who signs for goods is usually neither the
   * one who raised the order nor the one who approved it, and folding this into
   * either would hand out a power nobody asked for.
   */
  @Post(':id/receive')
  @HttpCode(200)
  @RequirePermission('purchase_order:receive')
  async receive(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(receivePurchaseOrderSchema)) body: ReceivePurchaseOrder,
    @IfMatch() version: number,
  ): Promise<Resource<PurchaseOrderDetail>> {
    return {
      data: await this.orders.receive(id, body, version),
      meta: { correlationId: getCorrelationId() },
    };
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @RequirePermission('purchase_order:create')
  async cancel(
    @Param('id') id: string,
    @IfMatch() version: number,
  ): Promise<Resource<PurchaseOrderDetail>> {
    return {
      data: await this.orders.cancel(id, version),
      meta: { correlationId: getCorrelationId() },
    };
  }
}

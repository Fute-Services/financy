import {
  createDelegationSchema,
  listDelegationsQuerySchema,
  type CreateDelegation,
  type Delegation,
  type ListDelegationsQuery,
  type Resource,
} from '@financy/contracts';
import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';

import { RequirePermission } from '../../platform/authorization/index.js';
import { IfMatch } from '../../platform/concurrency/index.js';
import { callerHas, getCorrelationId } from '../../platform/request-context/index.js';
import { ZodValidationPipe } from '../../platform/validation/index.js';
import { DelegationService } from './delegation.service.js';

/**
 * `/v1/approvals/delegations` (docs/10 §5.6, FR-APR-009).
 *
 * **One route, two powers.** Lending your own authority needs
 * `approval:delegate`, which most roles hold. Lending somebody *else's* is an
 * administrative act — the holder never agreed to it — and needs
 * `approval:delegate_any`, which the service checks separately. Splitting them
 * into two endpoints was the alternative, and it duplicates the whole body
 * schema to express a difference in one optional field.
 *
 * **Revocation is a `DELETE` that deletes nothing.** A chain resolved while the
 * delegation was live named the delegate, and that has to stay explicable; the
 * row is stamped `revokedAt` and stops applying from now on. The verb is the
 * right one for the caller's intent even though the storage is append-only.
 */
@Controller('approvals/delegations')
export class DelegationsController {
  constructor(private readonly delegations: DelegationService) {}

  @Get()
  @RequirePermission('approval:read')
  async list(
    @Query(new ZodValidationPipe(listDelegationsQuerySchema)) query: ListDelegationsQuery,
  ): Promise<Resource<Delegation[]>> {
    return {
      data: await this.delegations.list(query, callerHas('approval:delegate_any')),
      meta: { correlationId: getCorrelationId() },
    };
  }

  @Post()
  @RequirePermission('approval:delegate')
  async create(
    @Body(new ZodValidationPipe(createDelegationSchema)) body: CreateDelegation,
  ): Promise<Resource<Delegation>> {
    return {
      data: await this.delegations.create(body, callerHas('approval:delegate_any')),
      meta: { correlationId: getCorrelationId() },
    };
  }

  @Delete(':id')
  @RequirePermission('approval:delegate')
  async revoke(@Param('id') id: string, @IfMatch() version: number): Promise<Resource<Delegation>> {
    return {
      data: await this.delegations.revoke(id, version, callerHas('approval:delegate_any')),
      meta: { correlationId: getCorrelationId() },
    };
  }
}

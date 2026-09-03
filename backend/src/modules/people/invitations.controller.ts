import {
  createInvitationSchema,
  type CreateInvitation,
  type Invitation,
  type IssuedInvitation,
  type Resource,
} from '@financy/contracts';
import { Body, Controller, Delete, Get, HttpCode, Param, Post } from '@nestjs/common';

import { RequirePermission } from '../../platform/authorization/index.js';
import { getCorrelationId } from '../../platform/request-context/index.js';
import { ZodValidationPipe } from '../../platform/validation/index.js';
import { InvitationsService } from './invitations.service.js';

/**
 * `/v1/memberships/invitations` (docs/10 §5.3).
 *
 * Nested under memberships because an invitation is a membership that has not
 * happened yet: it carries the role and department the person will arrive
 * with, and accepting it creates exactly that membership.
 *
 * There is no `If-Match` on any of these. An invitation has no editable
 * fields — it is issued, then revoked or resent or accepted — so there is no
 * concurrent edit for a precondition to protect. Each transition refuses on
 * its own terms instead: a revoked invitation cannot be resent, an accepted
 * one cannot be revoked.
 */
@Controller('memberships/invitations')
export class InvitationsController {
  constructor(private readonly invitations: InvitationsService) {}

  @Get()
  @RequirePermission('user:read')
  async list(): Promise<Resource<Invitation[]>> {
    return {
      data: await this.invitations.list(),
      meta: { correlationId: getCorrelationId() },
    };
  }

  /**
   * Returns the token, once.
   *
   * The inviter is already authorised to invite this person, so handing them
   * a link to pass on is no wider a disclosure than the invitation itself —
   * and it means an invitation is not silently dead when mail delivery fails,
   * which is exactly what corporate mail filters do to transactional email.
   */
  @Post()
  @RequirePermission('user:invite')
  async create(
    @Body(new ZodValidationPipe(createInvitationSchema)) body: CreateInvitation,
  ): Promise<Resource<IssuedInvitation>> {
    return {
      data: await this.invitations.create(body),
      meta: { correlationId: getCorrelationId() },
    };
  }

  /** A fresh token; the previous one stops working. */
  @Post(':id/resend')
  @HttpCode(200)
  @RequirePermission('user:invite')
  async resend(@Param('id') id: string): Promise<Resource<IssuedInvitation>> {
    return {
      data: await this.invitations.resend(id),
      meta: { correlationId: getCorrelationId() },
    };
  }

  /**
   * `DELETE`, but the row survives with `revokedAt` set. That somebody was
   * invited, by whom, and when is evidence; only the token stops working.
   */
  @Delete(':id')
  @HttpCode(200)
  @RequirePermission('user:invite')
  async revoke(@Param('id') id: string): Promise<Resource<Invitation>> {
    return {
      data: await this.invitations.revoke(id),
      meta: { correlationId: getCorrelationId() },
    };
  }
}

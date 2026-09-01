import {
  changeRoleSchema,
  deactivateMembershipSchema,
  listPeopleQuerySchema,
  updateMembershipSchema,
  type ActiveSession,
  type ChangeRole,
  type DeactivateMembership,
  type ListPeopleQuery,
  type MembershipDetail,
  type OffsetCollection,
  type Person,
  type Resource,
  type UpdateMembership,
} from '@financy/contracts';
import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';

import { RequirePermission, RequireStepUp } from '../../platform/authorization/index.js';
import { IfMatch } from '../../platform/concurrency/index.js';
import { getCorrelationId } from '../../platform/request-context/index.js';
import { ZodValidationPipe } from '../../platform/validation/index.js';
import { MembershipsService } from './memberships.service.js';
import { PeopleService } from './people.service.js';

/**
 * `/v1/memberships` (docs/10 §5.3).
 *
 * The path the specification names. It shipped first as `/v1/people`, which
 * read better and matched nothing; one endpoint with two names is a drift
 * that only widens, so the earlier name is gone rather than aliased. The
 * *language* stays: "people" is what the screen is called, because a
 * `Membership` is an account's presence in one organisation and that is the
 * distinction the domain cares about, not the one the URL should carry.
 *
 * The role has its own endpoint rather than a field on the `PATCH`, and that
 * is the shape of the whole controller: a change that alters what somebody
 * *may do* is a different kind of request from one that corrects what team
 * they are on. It requires step-up re-authentication, refuses self-elevation
 * (INV-03) and the demotion of the last administrator (INV-04), and writes a
 * security event alongside the audit event (INV-08).
 */
@Controller('memberships')
export class MembershipsController {
  constructor(
    private readonly people: PeopleService,
    private readonly memberships: MembershipsService,
  ) {}

  @Get()
  @RequirePermission('user:read')
  async list(
    @Query(new ZodValidationPipe(listPeopleQuerySchema)) query: ListPeopleQuery,
  ): Promise<OffsetCollection<Person>> {
    const { items, total } = await this.people.list(query);

    return {
      data: items,
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        totalCount: total,
        // Ceiling, and at least one: a caller looking at an empty list should
        // see "page 1 of 1", not "page 1 of 0", which reads like a bug.
        totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
      },
      meta: { correlationId: getCorrelationId() },
    };
  }

  @Get(':id')
  @RequirePermission('user:read')
  async get(@Param('id') id: string): Promise<Resource<MembershipDetail>> {
    return {
      data: await this.memberships.get(id),
      meta: { correlationId: getCorrelationId() },
    };
  }

  /** Department, manager, and scope. Not the role, and not the status. */
  @Patch(':id')
  @RequirePermission('user:update')
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateMembershipSchema)) body: UpdateMembership,
    @IfMatch() version: number,
  ): Promise<Resource<MembershipDetail>> {
    return {
      data: await this.memberships.update(id, body, version),
      meta: { correlationId: getCorrelationId() },
    };
  }

  /**
   * Step-up is declared here rather than checked in the service, so the
   * requirement is visible on the route and the meta-test can see it. A role
   * change is the most consequential thing an administrator does to another
   * person's account; a stolen session should not be enough to make one.
   */
  @Post(':id/role')
  @HttpCode(200)
  @RequireStepUp()
  @RequirePermission('membership:manage_role')
  async changeRole(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(changeRoleSchema)) body: ChangeRole,
    @IfMatch() version: number,
  ): Promise<Resource<MembershipDetail>> {
    return {
      data: await this.memberships.changeRole(id, body, version),
      meta: { correlationId: getCorrelationId() },
    };
  }

  @Post(':id/deactivate')
  @HttpCode(200)
  @RequirePermission('user:deactivate')
  async deactivate(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(deactivateMembershipSchema)) body: DeactivateMembership,
    @IfMatch() version: number,
  ): Promise<Resource<MembershipDetail>> {
    return {
      data: await this.memberships.deactivate(id, body.reason, version),
      meta: { correlationId: getCorrelationId() },
    };
  }

  @Post(':id/reactivate')
  @HttpCode(200)
  @RequirePermission('user:update')
  async reactivate(
    @Param('id') id: string,
    @IfMatch() version: number,
  ): Promise<Resource<MembershipDetail>> {
    return {
      data: await this.memberships.reactivate(id, version),
      meta: { correlationId: getCorrelationId() },
    };
  }

  /**
   * The live sessions behind a membership (task 1.5.8).
   *
   * Sessions belong to the account, not to the membership — one account can
   * be signed into several organisations — so this lists all of them. An
   * administrator about to revoke needs to know they are ending all of it.
   */
  @Get(':id/sessions')
  @RequirePermission('session:revoke_any')
  async sessions(@Param('id') id: string): Promise<Resource<ActiveSession[]>> {
    return {
      data: await this.memberships.listSessions(id),
      meta: { correlationId: getCorrelationId() },
    };
  }

  /**
   * Sign someone out of everything, without removing their access.
   *
   * Step-up, because a stolen cookie should not be enough to lock a colleague
   * out of their own account. `DELETE` on the collection rather than on one
   * session: revoking devices one at a time is a race against whoever is
   * using them.
   *
   * There is no `If-Match`. This does not edit the membership — its version
   * does not move — and a precondition on a record the request does not
   * change would be a precondition against nothing.
   */
  @Delete(':id/sessions')
  @HttpCode(200)
  @RequireStepUp()
  @RequirePermission('session:revoke_any')
  async revokeSessions(@Param('id') id: string): Promise<Resource<{ revoked: number }>> {
    return {
      data: { revoked: await this.memberships.revokeSessions(id) },
      meta: { correlationId: getCorrelationId() },
    };
  }
}

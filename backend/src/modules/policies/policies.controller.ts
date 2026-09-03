import {
  createPolicySchema,
  publishPolicySchema,
  savePolicyRulesSchema,
  simulatePolicySchema,
  updatePolicySchema,
  type CreatePolicy,
  type PolicyDetail,
  type PolicySummary,
  type PublishPolicy,
  type Resource,
  type SavePolicyRules,
  type SimulatePolicy,
  type SimulationResult,
  type UpdatePolicy,
} from '@financy/contracts';
import { Body, Controller, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';

import { RequirePermission } from '../../platform/authorization/index.js';
import { IfMatch } from '../../platform/concurrency/index.js';
import { getCorrelationId } from '../../platform/request-context/index.js';
import { ZodValidationPipe } from '../../platform/validation/index.js';
import { PoliciesService } from './policies.service.js';
import { PolicySimulationService } from './policy-simulation.service.js';

/**
 * `/v1/policies` (docs/10 §5.5).
 *
 * **Saving rules and publishing them are different routes**, and the split is
 * the control rather than a REST preference. Saving edits a draft that decides
 * nothing; publishing freezes it and points evaluation at it. Collapsing them
 * would mean every keystroke in the rule builder changed what the organisation
 * is allowed to spend.
 *
 * **Simulation is a `POST` that changes nothing**, which is the one place this
 * API departs from the obvious verb. A `GET` was the alternative and it does
 * not survive the input: the context is a nested object with money in it, and
 * a query string carrying an amount and a currency is the shape that eventually
 * gets a currency wrong. It reads, it never writes, and it is idempotent.
 *
 * **Publishing takes `If-Match`.** It is the transition that changes what the
 * organisation's rules are, and two authors publishing different drafts of the
 * same policy at the same moment must not both succeed.
 */
@Controller('policies')
export class PoliciesController {
  constructor(
    private readonly policies: PoliciesService,
    private readonly simulation: PolicySimulationService,
  ) {}

  @Get()
  @RequirePermission('policy:read')
  async list(): Promise<Resource<PolicySummary[]>> {
    return { data: await this.policies.list(), meta: { correlationId: getCorrelationId() } };
  }

  /**
   * Simulate a decision.
   *
   * Declared before `:id` deliberately — Nest matches routes in declaration
   * order, and `simulate` would otherwise be read as a policy id and answer
   * 404 for every call.
   */
  @Post('simulate')
  @HttpCode(200)
  @RequirePermission('policy:read')
  async simulate(
    @Body(new ZodValidationPipe(simulatePolicySchema)) body: SimulatePolicy,
  ): Promise<Resource<SimulationResult>> {
    return {
      data: await this.simulation.simulate(body),
      meta: { correlationId: getCorrelationId() },
    };
  }

  @Get(':id')
  @RequirePermission('policy:read')
  async get(@Param('id') id: string): Promise<Resource<PolicyDetail>> {
    return { data: await this.policies.get(id), meta: { correlationId: getCorrelationId() } };
  }

  @Post()
  @RequirePermission('policy:manage')
  async create(
    @Body(new ZodValidationPipe(createPolicySchema)) body: CreatePolicy,
  ): Promise<Resource<PolicyDetail>> {
    return { data: await this.policies.create(body), meta: { correlationId: getCorrelationId() } };
  }

  @Patch(':id')
  @RequirePermission('policy:manage')
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updatePolicySchema)) body: UpdatePolicy,
    @IfMatch() version: number,
  ): Promise<Resource<PolicyDetail>> {
    return {
      data: await this.policies.update(id, body, version),
      meta: { correlationId: getCorrelationId() },
    };
  }

  /**
   * Replace the draft's rules.
   *
   * No `If-Match`. The precondition would be on the policy row, and the rules
   * live on a version — an author who renamed the policy in another tab would
   * be refused a rule save for a change that cannot conflict with theirs.
   */
  @Post(':id/rules')
  @HttpCode(200)
  @RequirePermission('policy:manage')
  async saveRules(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(savePolicyRulesSchema)) body: SavePolicyRules,
  ): Promise<Resource<PolicyDetail>> {
    return {
      data: await this.policies.saveRules(id, body),
      meta: { correlationId: getCorrelationId() },
    };
  }

  @Post(':id/publish')
  @HttpCode(200)
  @RequirePermission('policy:manage')
  async publish(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(publishPolicySchema)) body: PublishPolicy,
    @IfMatch() version: number,
  ): Promise<Resource<PolicyDetail>> {
    return {
      data: await this.policies.publish(id, body, version),
      meta: { correlationId: getCorrelationId() },
    };
  }

  @Post(':id/archive')
  @HttpCode(200)
  @RequirePermission('policy:manage')
  async archive(
    @Param('id') id: string,
    @IfMatch() version: number,
  ): Promise<Resource<PolicyDetail>> {
    return {
      data: await this.policies.setStatus(id, 'ARCHIVED', version),
      meta: { correlationId: getCorrelationId() },
    };
  }

  @Post(':id/restore')
  @HttpCode(200)
  @RequirePermission('policy:manage')
  async restore(
    @Param('id') id: string,
    @IfMatch() version: number,
  ): Promise<Resource<PolicyDetail>> {
    return {
      data: await this.policies.setStatus(id, 'ACTIVE', version),
      meta: { correlationId: getCorrelationId() },
    };
  }
}

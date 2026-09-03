import {
  changeCardStatusSchema,
  issueCardSchema,
  listCardsQuerySchema,
  setCardLimitSchema,
  updateCardSchema,
  type CardDetail,
  type CardRecord,
  type ChangeCardStatus,
  type IssueCard,
  type ListCardsQuery,
  type OffsetCollection,
  type Resource,
  type SetCardLimit,
  type UpdateCard,
} from '@financy/contracts';
import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';

import { RequirePermission } from '../../platform/authorization/index.js';
import { IfMatch } from '../../platform/concurrency/index.js';
import { getCorrelationId } from '../../platform/request-context/index.js';
import { ZodValidationPipe } from '../../platform/validation/index.js';
import { CardsService } from './cards.service.js';

/**
 * `/v1/cards` (docs/10 §5.7).
 *
 * **Five write routes, five permissions, and that is not over-engineering.**
 * Issuing a card, changing its limit, freezing it, and terminating it are four
 * different powers, held by different people in every organisation that has
 * thought about it: a team lead may freeze a card they hold, only finance may
 * raise its limit, and terminating is permanent. One `card:manage` covering all
 * four would mean granting the ability to raise a limit in order to let
 * somebody freeze a lost card.
 *
 * **Every state change takes `If-Match`.** Two people freezing the same card is
 * harmless; two people setting different limits at the same instant is not, and
 * the version makes the second one a `409` rather than a silent overwrite.
 *
 * **Nothing here returns a card number.** No route does, no response shape has
 * a field for one, and the credential lives with the issuer.
 */
@Controller('cards')
export class CardsController {
  constructor(private readonly cards: CardsService) {}

  @Get()
  @RequirePermission('card:read')
  async list(
    @Query(new ZodValidationPipe(listCardsQuerySchema)) query: ListCardsQuery,
  ): Promise<OffsetCollection<CardRecord>> {
    const { items, total } = await this.cards.list(query);

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

  @Get(':id')
  @RequirePermission('card:read')
  async get(@Param('id') id: string): Promise<Resource<CardDetail>> {
    return { data: await this.cards.get(id), meta: { correlationId: getCorrelationId() } };
  }

  @Post()
  @RequirePermission('card:create')
  async issue(
    @Body(new ZodValidationPipe(issueCardSchema)) body: IssueCard,
  ): Promise<Resource<CardDetail>> {
    return { data: await this.cards.issue(body), meta: { correlationId: getCorrelationId() } };
  }

  @Patch(':id')
  @RequirePermission('card:create')
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateCardSchema)) body: UpdateCard,
    @IfMatch() version: number,
  ): Promise<Resource<CardDetail>> {
    return {
      data: await this.cards.update(id, body, version),
      meta: { correlationId: getCorrelationId() },
    };
  }

  @Post(':id/limit')
  @HttpCode(200)
  @RequirePermission('card:update_limit')
  async setLimit(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(setCardLimitSchema)) body: SetCardLimit,
    @IfMatch() version: number,
  ): Promise<Resource<CardDetail>> {
    return {
      data: await this.cards.setLimit(id, body, version),
      meta: { correlationId: getCorrelationId() },
    };
  }

  @Post(':id/freeze')
  @HttpCode(200)
  @RequirePermission('card:lock')
  async freeze(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(changeCardStatusSchema)) body: ChangeCardStatus,
    @IfMatch() version: number,
  ): Promise<Resource<CardDetail>> {
    return {
      data: await this.cards.changeStatus(id, 'FROZEN', body, version),
      meta: { correlationId: getCorrelationId() },
    };
  }

  @Post(':id/unfreeze')
  @HttpCode(200)
  @RequirePermission('card:lock')
  async unfreeze(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(changeCardStatusSchema)) body: ChangeCardStatus,
    @IfMatch() version: number,
  ): Promise<Resource<CardDetail>> {
    return {
      data: await this.cards.changeStatus(id, 'ACTIVE', body, version),
      meta: { correlationId: getCorrelationId() },
    };
  }

  /**
   * Permanent. There is deliberately no route back.
   *
   * The issuer destroys the credential, so a `restore` would produce a card
   * that looks alive and declines every charge — worse for the holder than a
   * card that says it is gone.
   */
  @Post(':id/terminate')
  @HttpCode(200)
  @RequirePermission('card:terminate')
  async terminate(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(changeCardStatusSchema)) body: ChangeCardStatus,
    @IfMatch() version: number,
  ): Promise<Resource<CardDetail>> {
    return {
      data: await this.cards.changeStatus(id, 'TERMINATED', body, version),
      meta: { correlationId: getCorrelationId() },
    };
  }
}

import {
  createLeadSchema,
  type CreateLead,
  type LeadReceipt,
  type Resource,
} from '@financy/contracts';
import { Body, Controller, HttpCode, Post, Req } from '@nestjs/common';
import type { Request } from 'express';

import { Public } from '../../platform/authorization/index.js';
import { RateLimit } from '../../platform/rate-limit/index.js';
import { getCorrelationId } from '../../platform/request-context/index.js';
import { ZodValidationPipe } from '../../platform/validation/index.js';
import { LeadsService } from './leads.service.js';

/**
 * How long a `User-Agent` is kept.
 *
 * Long enough to identify a browser or a bot, short enough that the field is
 * not a place to store 8 KB of anything. It is caller-controlled text.
 */
const USER_AGENT_MAX = 500;

/**
 * `POST /v1/leads` — the demo request on the public site.
 *
 * ## Why this is `@Public()`
 *
 * The people it exists for do not have accounts. That is the whole endpoint:
 * a prospect fills in a form on the marketing site and the API records it.
 * There is no session to require and nothing a caller can read back.
 *
 * Making a route public is the highest-consequence one-line change in this
 * codebase, so what limits the damage is written out rather than assumed:
 *
 *  - **It only writes.** There is no read route here at all. Sales reads the
 *    collection directly; exposing a list would mean building tenant-free
 *    authorisation for a screen that does not exist.
 *  - **It returns a constant.** `{ received: true }` and nothing else — no id,
 *    no timestamp, no echo. A public write that reported what it stored is a
 *    way to probe what the server keeps.
 *  - **It is rate limited.** Three an hour per address, matching the ceiling
 *    docs/10 §7 sets for `POST /auth/register`, which is the closest thing to
 *    this: unauthenticated, cheap to send, and expensive to receive.
 *  - **Every field is bounded** by `createLeadSchema`, because an unbounded
 *    text column reachable without a session is a storage bill somebody else
 *    decides the size of.
 *
 * ## Why `201` with a body rather than `204`
 *
 * `204` would say the same thing in fewer bytes, and the form's success state
 * would then hinge on a status code alone. A body the client can assert on is
 * what makes "it worked" a fact the browser read rather than an inference from
 * the absence of an error.
 */
@Controller('leads')
export class LeadsController {
  constructor(private readonly leads: LeadsService) {}

  @Post()
  @Public()
  @RateLimit(3, 60 * 60)
  @HttpCode(201)
  async submit(
    @Body(new ZodValidationPipe(createLeadSchema)) body: CreateLead,
    @Req() request: Request,
  ): Promise<Resource<LeadReceipt>> {
    await this.leads.submit({
      ...body,
      // Set here from the route, never from the request body. A caller-supplied
      // `source` would be arbitrary text written straight into whatever tool
      // sales reads this in.
      source: 'contact',
      ipAddress: request.ip ?? null,
      userAgent: userAgent(request),
    });

    return {
      data: { received: true },
      meta: { correlationId: getCorrelationId() },
    };
  }
}

function userAgent(request: Request): string | null {
  const header = request.headers['user-agent'];

  if (typeof header !== 'string' || header.trim() === '') return null;

  return header.slice(0, USER_AGENT_MAX);
}

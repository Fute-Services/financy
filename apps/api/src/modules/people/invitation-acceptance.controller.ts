import {
  acceptInvitationSchema,
  type AcceptInvitation,
  type InvitationPreview,
  type Resource,
  type SessionResponse,
} from '@financy/contracts';
import { Body, Controller, Get, HttpCode, Param, Post, Res } from '@nestjs/common';
import type { Response } from 'express';

import { Public } from '../../platform/authorization/index.js';
import { ConfigService } from '../../platform/config/index.js';
import { getCorrelationId } from '../../platform/request-context/index.js';
import { ZodValidationPipe } from '../../platform/validation/index.js';
import { AuthService } from '../auth/index.js';
import { setSessionCookie } from '../auth/session-cookie.js';
import { InvitationsService } from './invitations.service.js';

/**
 * `/v1/auth/invitations` — the two public halves of the invitation flow
 * (docs/10 §5.1).
 *
 * It lives in the people module rather than the auth module, and routes into
 * the auth path anyway. That is deliberate: the *logic* is invitations, so it
 * belongs beside the rest of them, while the *URL* is `/auth` because these
 * are the only two invitation endpoints a signed-out browser can reach and
 * the path is where a reader looks to answer "what works without a session".
 * Putting the controller in the auth module instead would make the auth
 * module depend on the people module, which already depends on it.
 *
 * Both are `@Public()`, and both are safe to be. **The token is the
 * authorisation**: it determines which organisation is being joined, so there
 * is no session to scope by and nothing a caller without a token can learn.
 * Every failure — no such token, already accepted, revoked, expired — answers
 * the same `404`, because distinguishing them tells somebody guessing at
 * tokens which guesses were close.
 */
@Controller('auth/invitations')
export class InvitationAcceptanceController {
  constructor(
    private readonly invitations: InvitationsService,
    private readonly auth: AuthService,
    private readonly config: ConfigService,
  ) {}

  /**
   * What the acceptance screen needs before it can render a form: the
   * organisation's name, the address invited, and whether a password is
   * required. All three are things the token holder is about to be told
   * anyway; none reveals anything about an address they have no token for.
   */
  @Get(':token')
  @Public()
  async preview(@Param('token') token: string): Promise<Resource<InvitationPreview>> {
    return {
      data: await this.invitations.preview(token),
      meta: { correlationId: getCorrelationId() },
    };
  }

  /**
   * Accept, creating the account if there is not one, and sign in.
   *
   * Signing in here rather than redirecting to the login screen is the point
   * of the flow: a person who has just set a password and been told they
   * joined should not then be asked to prove it again.
   */
  @Post('accept')
  @Public()
  @HttpCode(201)
  async accept(
    @Body(new ZodValidationPipe(acceptInvitationSchema)) body: AcceptInvitation,
    @Res({ passthrough: true }) response: Response,
  ): Promise<SessionResponse> {
    const result = await this.invitations.accept(body);

    setSessionCookie(response, this.config, result.session);

    return this.auth.describeSession(result.membershipId, result.session.absoluteExpiresAt);
  }
}

import {
  loginRequestSchema,
  registerRequestSchema,
  stepUpRequestSchema,
  type LoginRequest,
  type RegisterRequest,
  type SessionResponse,
  type StepUpRequest,
  type StepUpResponse,
} from '@financy/contracts';
import { UnauthenticatedError } from '@financy/core';
import { Body, Controller, Get, HttpCode, Post, Res } from '@nestjs/common';
import type { Response } from 'express';

import { Public } from '../../platform/authorization/index.js';
import { ConfigService } from '../../platform/config/index.js';
import { getContext } from '../../platform/request-context/index.js';
import { ZodValidationPipe } from '../../platform/validation/index.js';
import { AuthService } from './auth.service.js';
import { cookieOptions, setSessionCookie } from './session-cookie.js';

/**
 * `/v1/auth` (docs/10 §5.1).
 *
 * The session token travels in an `httpOnly` cookie, never in the response
 * body and never in `localStorage`. That removes the XSS token-theft class
 * entirely: script running on the page cannot read the cookie, so a content
 * injection cannot exfiltrate a session. CSRF is covered by `SameSite=Lax`
 * plus the origin check, which is a much smaller problem to solve than "any
 * script anywhere can steal a login" (docs/10 §2.1).
 */
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Creates organisation, user, `ORG_ADMIN` membership, default entity, and
   * the category tree — atomically (FR-AUTH-001).
   */
  @Post('register')
  @Public()
  @HttpCode(201)
  async register(
    @Body(new ZodValidationPipe(registerRequestSchema)) dto: RegisterRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<SessionResponse> {
    const result = await this.auth.register(dto);
    setSessionCookie(response, this.config, result.session);

    return this.auth.describeSession(result.membershipId, result.session.absoluteExpiresAt);
  }

  /**
   * Every failure here is the same failure: `401`, one message, and the same
   * elapsed time whether or not the account exists. The difference is the
   * information an attacker is actually after.
   */
  @Post('login')
  @Public()
  @HttpCode(200)
  async login(
    @Body(new ZodValidationPipe(loginRequestSchema)) dto: LoginRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<SessionResponse> {
    const result = await this.auth.login(dto);
    setSessionCookie(response, this.config, result.session);

    return this.auth.describeSession(result.membershipId, result.session.absoluteExpiresAt);
  }

  /**
   * Re-prove the password on the session already in hand (FR-AUTH-010).
   *
   * Deliberately **not** `@Public()`: it operates on an existing session, and
   * a public version taking an email would be a second login endpoint with a
   * different name and none of login's protections.
   *
   * No `@RequirePermission()` either, and no `@RequireStepUp()` — requiring
   * step-up to obtain step-up is a lock whose key is inside it. Like
   * `session` and `logout`, this acts on the caller's own session rather than
   * on organisation data, so it is session-scoped: the route-access meta-test
   * names all three explicitly, so a fourth is a decision rather than an
   * oversight.
   *
   * Borrowing an unrelated permission every role happens to hold would have
   * satisfied the meta-test and taught the next reader that permissions here
   * are decorative.
   */
  @Post('step-up')
  @HttpCode(200)
  async stepUp(
    @Body(new ZodValidationPipe(stepUpRequestSchema)) dto: StepUpRequest,
  ): Promise<StepUpResponse> {
    const sessionId = getContext()?.sessionId;

    if (sessionId === undefined) throw new UnauthenticatedError();

    const expiresAt = await this.auth.stepUp(sessionId, dto.password);

    return { expiresAt: expiresAt.toISOString() };
  }

  /**
   * Revokes server-side as well as clearing the cookie. Clearing the cookie
   * alone would leave a token that still works for anyone who captured it.
   */
  @Post('logout')
  @HttpCode(204)
  async logout(@Res({ passthrough: true }) response: Response): Promise<void> {
    const sessionId = getContext()?.sessionId;

    if (sessionId !== undefined) {
      await this.auth.logout(sessionId);
    }

    response.clearCookie(this.config.get('SESSION_COOKIE_NAME'), cookieOptions(this.config));
  }

  /** The current user, organisation, role, and resolved permission set. */
  @Get('session')
  async session(): Promise<SessionResponse> {
    const context = getContext();

    /* c8 ignore next 3 -- the guard rejects before this can be reached. */
    if (context?.membershipId === undefined) {
      throw new UnauthenticatedError();
    }

    const expiresAt = new Date(
      Date.now() + this.config.get('SESSION_ABSOLUTE_TIMEOUT_HOURS') * 3_600_000,
    );

    // The guard resolved this caller's permissions a moment ago. Handing them
    // over saves re-walking the role's ninety-odd grants on the one route the
    // web app calls for every page it renders.
    return this.auth.describeSession(context.membershipId, expiresAt, context.permissions);
  }
}

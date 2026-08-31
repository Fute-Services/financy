import {
  loginRequestSchema,
  registerRequestSchema,
  type LoginRequest,
  type RegisterRequest,
  type SessionResponse,
} from '@financy/contracts';
import { UnauthenticatedError } from '@financy/core';
import { Body, Controller, Get, HttpCode, Post, Res } from '@nestjs/common';
import type { CookieOptions, Response } from 'express';

import { Public } from '../../platform/authorization/index.js';
import { ConfigService } from '../../platform/config/index.js';
import { getContext } from '../../platform/request-context/index.js';
import { ZodValidationPipe } from '../../platform/validation/index.js';
import { AuthService } from './auth.service.js';
import type { IssuedSession } from './session.service.js';

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
    this.setSessionCookie(response, result.session);

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
    this.setSessionCookie(response, result.session);

    return this.auth.describeSession(result.membershipId, result.session.absoluteExpiresAt);
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

    response.clearCookie(this.config.get('SESSION_COOKIE_NAME'), this.cookieOptions());
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

    return this.auth.describeSession(context.membershipId, expiresAt);
  }

  // ── cookie ──────────────────────────────────────────────────────────────

  private setSessionCookie(response: Response, session: IssuedSession): void {
    response.cookie(this.config.get('SESSION_COOKIE_NAME'), session.token, {
      ...this.cookieOptions(),
      expires: session.absoluteExpiresAt,
    });
  }

  private cookieOptions(): CookieOptions {
    return {
      // Script cannot read it. This is the property that matters.
      httpOnly: true,
      // `Lax` rather than `Strict`: `Strict` drops the cookie on a top-level
      // navigation from an email link, so a user following an invitation
      // arrives logged out. `Lax` still blocks the cross-site POST that CSRF
      // needs.
      sameSite: 'lax',
      // Off locally so `http://localhost` works at all; required everywhere
      // else, where a cookie sent over plaintext is a cookie in the clear.
      secure: this.config.isProductionLike,
      path: '/',
    };
  }
}

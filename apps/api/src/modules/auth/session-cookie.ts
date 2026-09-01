import type { CookieOptions, Response } from 'express';

import type { ConfigService } from '../../platform/config/index.js';
import type { IssuedSession } from './session.service.js';

/**
 * How a session cookie is written, in one place.
 *
 * Extracted the moment a second controller needed it — invitation acceptance
 * signs the new member in, exactly as login does. Two copies of these options
 * is how one of them ends up without `httpOnly` after a refactor, and the
 * difference would not show up in any test that did not specifically look for
 * it.
 */
export function cookieOptions(config: ConfigService): CookieOptions {
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
    secure: config.isProductionLike,
    path: '/',
  };
}

export function setSessionCookie(
  response: Response,
  config: ConfigService,
  session: IssuedSession,
): void {
  response.cookie(config.get('SESSION_COOKIE_NAME'), session.token, {
    ...cookieOptions(config),
    expires: session.absoluteExpiresAt,
  });
}

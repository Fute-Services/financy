import { SetMetadata } from '@nestjs/common';

/**
 * Route access declarations.
 *
 * The default is **authenticated**, so a route that declares nothing is
 * rejected rather than exposed. `@Public()` is the opt-out and has to be
 * written deliberately — a forgotten decorator locks a route down, which is
 * the failure mode you want (docs/10 §4).
 *
 * A meta-test enumerates the Nest route table and fails if any route declares
 * neither `@Public()` nor `@RequirePermission()`. That is what protects
 * against the endpoint added under time pressure six months from now.
 */

export const PUBLIC_KEY = 'financy:public';
export const PERMISSION_KEY = 'financy:permission';
export const STEP_UP_KEY = 'financy:step-up';

/** No session required. Login, register, invitation acceptance, health. */
export const Public = () => SetMetadata(PUBLIC_KEY, true);

/**
 * The permission the caller's membership must hold.
 *
 * Answers *may you do this at all*. Which rows you may do it to is a separate
 * question, answered by the scope predicate — conflating the two is how a
 * manager ends up approving another department's spend.
 */
export const RequirePermission = (permission: string) => SetMetadata(PERMISSION_KEY, permission);

/**
 * Re-authentication within the step-up window for high-risk actions —
 * role changes, revoking another person's sessions, finance overrides.
 */
export const RequireStepUp = () => SetMetadata(STEP_UP_KEY, true);

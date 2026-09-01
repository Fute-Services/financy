import { StaleVersionError } from '@financy/core';

/**
 * Refuse a write whose `If-Match` does not match the row that was read.
 *
 * The comparison is here, in application code, and the update is then issued
 * with `where: { id, version }` so the database makes the same check
 * atomically. Both are needed and neither is redundant: this one produces the
 * error a client can act on — it names the version it has and the version that
 * exists — while the `where` clause closes the window between the read and the
 * write, where another request can commit and this check would still pass.
 *
 * A caller that only does one of the two has a race; a caller that only does
 * the `where` clause reports "0 rows updated", which is indistinguishable from
 * "the row was deleted" and gives the client nothing to say to the user.
 */
export function guardVersion(entity: string, expected: number, actual: number): void {
  if (expected !== actual) throw new StaleVersionError(entity, expected, actual);
}

/**
 * Did this write lose a race with a simultaneous one?
 *
 * MongoDB aborts one of two transactions that touch the same document at the
 * same instant, and Prisma surfaces that as `P2034` — "write conflict or
 * deadlock, please retry". It is not a bug and it is not an outage: it is the
 * database doing exactly what makes concurrent approvals safe.
 *
 * **What matters is that it never reaches the caller as a `500`.** A second
 * approver pressing the button at the same moment as the first is the ordinary
 * case in a parallel step (FR-APR-011), and "something went wrong, please try
 * again" is both wrong and unactionable — the step *was* approved, by somebody
 * else, a millisecond earlier.
 *
 * Detected structurally rather than by importing Prisma's error class, because
 * the platform layer must not depend on the ORM (docs/08 §4.3) — and because
 * the shape is stable in a way the class hierarchy is not.
 */
export function isWriteConflict(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;

  const code = (error as { code?: unknown }).code;

  return code === 'P2034';
}

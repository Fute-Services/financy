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

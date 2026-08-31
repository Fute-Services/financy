import {
  ACTOR_TYPES,
  ENTITY_STATUSES,
  MEMBERSHIP_SCOPES,
  MEMBERSHIP_STATUSES,
  ROLE_KEYS,
} from '@financy/contracts';
import { $Enums } from '@prisma/client';
import { describe, expect, it } from 'vitest';

/**
 * The contract's enums and the database's enums are the same enums.
 *
 * `@financy/contracts` is compiled into the browser bundle, so it cannot import
 * Prisma and has to restate every enum by hand. This package imports both, and
 * is therefore the only place the two copies can be compared — which makes it
 * the only place drift can be caught by a build rather than by a user.
 *
 * The drift is not hypothetical. The first draft of `people.ts` wrote
 * `ORGANIZATION` where the schema says `ORGANISATION`, and gave
 * `MembershipStatus` four values where the schema has two. Both typechecked
 * perfectly: a Zod enum is just a list of strings, and nothing in the compiler
 * knew the list was supposed to mean something. A member whose status the API
 * could describe but the database could not store would have failed at the
 * write, in production, with a Prisma error naming a column.
 *
 * Compared as sorted sets, because declaration order carries no meaning in
 * either place and demanding it match would make this test fail for a reason
 * nobody cares about.
 */

function sorted(values: readonly string[]): string[] {
  return [...values].sort();
}

describe('contract enums match the schema', () => {
  it.each([
    ['MembershipScope', MEMBERSHIP_SCOPES, $Enums.MembershipScope],
    ['MembershipStatus', MEMBERSHIP_STATUSES, $Enums.MembershipStatus],
    ['EntityStatus', ENTITY_STATUSES, $Enums.EntityStatus],
    ['ActorType', ACTOR_TYPES, $Enums.ActorType],
  ])('%s', (_name, contract, prisma) => {
    expect(sorted(contract)).toEqual(sorted(Object.values(prisma)));
  });

  /**
   * Roles are not a Prisma enum — they are rows, provisioned per organisation
   * from `ROLE_KEYS`. Asserted here anyway because the same class of mistake
   * applies: `provisionOrganizationRoles` iterates this list, so a key invented
   * anywhere else produces a role nobody holds and a permission check that
   * always fails.
   */
  it('role keys are the five the seed provisions', () => {
    expect(sorted(ROLE_KEYS)).toEqual(
      sorted(['ORG_ADMIN', 'FINANCE_ADMIN', 'MANAGER', 'EMPLOYEE', 'AUDITOR']),
    );
  });
});

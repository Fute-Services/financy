import { describe, expect, it } from 'vitest';

import {
  ACTOR_TYPE_LABELS,
  auditEventSchema,
  describeAction,
  listAuditEventsQuerySchema,
} from './audit.js';

const ID = '0192f3a1-9c2b-7d4e-8f01-2a3b4c5d6e7f';

describe('describeAction', () => {
  it.each([
    ['membership.created', 'Membership created'],
    ['policy.published', 'Policy published'],
    ['spend_request.approved', 'Spend request approved'],
    ['budget.reallocated', 'Budget reallocated'],
  ])('%s reads as "%s"', (action, expected) => {
    expect(describeAction(action)).toBe(expected);
  });

  /**
   * Falls back to the key, not to "Unknown action".
   *
   * A reader who sees `budget.reallocated` learns what happened. A reader who
   * sees "Unknown action" learns only that this screen is out of date — and on
   * an audit trail, that is the one thing it must never suggest.
   */
  it.each(['', 'malformed', 'too.many.dots'])(
    'leaves %s alone rather than inventing a label',
    (action) => {
      const described = describeAction(action);
      expect(
        described === action || described.toLowerCase().startsWith(action.split('.')[0]!),
      ).toBe(true);
      expect(described).not.toMatch(/unknown/i);
    },
  );

  it('does not lose a multi-word verb', () => {
    expect(describeAction('session.revoked_all')).toBe('Session revoked all');
  });
});

describe('listAuditEventsQuerySchema', () => {
  it('defaults to a limit rather than requiring one', () => {
    const result = listAuditEventsQuerySchema.safeParse({});
    expect(result.success).toBe(true);
  });

  /**
   * The rule that shapes every query schema here: an unknown parameter is a
   * failure, not a silent ignore. Dropping `?actiom=` returns the whole trail
   * to someone who believes they filtered it.
   */
  it('rejects an unknown parameter instead of ignoring it', () => {
    expect(listAuditEventsQuerySchema.safeParse({ actiom: 'membership.created' }).success).toBe(
      false,
    );
  });

  it('drops empty strings, so an untouched filter input means "no filter"', () => {
    const result = listAuditEventsQuerySchema.parse({ action: '', resourceType: 'membership' });
    expect(result.action).toBeUndefined();
    expect(result.resourceType).toBe('membership');
  });

  it('accepts a half-open date range', () => {
    const result = listAuditEventsQuerySchema.safeParse({
      from: '2026-08-01T00:00:00.000Z',
      before: '2026-09-01T00:00:00.000Z',
    });
    expect(result.success).toBe(true);
  });

  it('rejects a date that is not a timestamp', () => {
    expect(listAuditEventsQuerySchema.safeParse({ from: '2026-08-01' }).success).toBe(false);
  });
});

describe('auditEventSchema', () => {
  const valid = {
    id: ID,
    action: 'membership.created',
    resourceType: 'membership',
    resourceId: ID,
    actorType: 'USER',
    actorLabel: 'Ada Lovelace',
    actorMembershipId: ID,
    before: null,
    after: { roleKey: 'EMPLOYEE' },
    metadata: {},
    ipAddress: '203.0.113.4',
    correlationId: 'a1b2c3d4-e5f6',
    createdAt: '2026-08-31T10:00:00.000Z',
  };

  it('accepts a complete event', () => {
    expect(auditEventSchema.safeParse(valid).success).toBe(true);
  });

  /**
   * A system-written event has no actor membership and no label. Requiring
   * either would make the schema reject the retention job's own record of what
   * it deleted.
   */
  it('accepts a system event with no human behind it', () => {
    const result = auditEventSchema.safeParse({
      ...valid,
      actorType: 'SYSTEM',
      actorLabel: null,
      actorMembershipId: null,
      ipAddress: null,
    });

    expect(result.success).toBe(true);
  });

  it('requires a correlation id, which is what support traces a report by', () => {
    const { correlationId: _omitted, ...withoutCorrelation } = valid;
    expect(auditEventSchema.safeParse(withoutCorrelation).success).toBe(false);
  });

  it('labels every actor type it accepts', () => {
    for (const actorType of Object.keys(ACTOR_TYPE_LABELS)) {
      expect(auditEventSchema.safeParse({ ...valid, actorType }).success).toBe(true);
    }
  });
});

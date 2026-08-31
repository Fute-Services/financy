import { describe, expect, it } from 'vitest';

import {
  enterContext,
  getContext,
  getCorrelationId,
  getOrganizationId,
  runWithContext,
} from './request-context.js';

const context = { correlationId: 'corr-1', startedAt: Date.now() };

describe('runWithContext', () => {
  it('makes the context visible to synchronous callees', () => {
    runWithContext(context, () => {
      expect(getContext()?.correlationId).toBe('corr-1');
    });
  });

  /**
   * The property the whole design rests on. If the context did not survive an
   * `await`, every repository call — all of which are async — would see
   * nothing, and the tenant predicate would be missing exactly where it
   * matters.
   */
  it('survives an await', async () => {
    await runWithContext(context, async () => {
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 1));
      expect(getContext()?.correlationId).toBe('corr-1');
    });
  });

  it('does not leak into a sibling request', () => {
    runWithContext({ ...context, organizationId: 'org-a' }, () => {
      expect(getOrganizationId()).toBe('org-a');
    });

    runWithContext({ ...context, organizationId: 'org-b' }, () => {
      expect(getOrganizationId()).toBe('org-b');
    });

    expect(getOrganizationId()).toBeUndefined();
  });

  it('keeps two concurrent requests apart', async () => {
    const observe = (organizationId: string) =>
      runWithContext({ ...context, organizationId }, async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return getOrganizationId();
      });

    await expect(Promise.all([observe('org-a'), observe('org-b')])).resolves.toEqual([
      'org-a',
      'org-b',
    ]);
  });
});

describe('outside a request', () => {
  it('reports no context rather than inventing one', () => {
    expect(getContext()).toBeUndefined();
  });

  /**
   * `undefined` is the honest answer, and the Prisma tenant extension turns it
   * into a hard failure. A default here would defeat that.
   */
  it('reports no organisation', () => {
    expect(getOrganizationId()).toBeUndefined();
  });

  /**
   * The one exception. A log line or an error envelope with an empty
   * correlation id looks traceable and is not, which is worse than obviously
   * having none.
   */
  it('still produces a correlation id', () => {
    const id = getCorrelationId();
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(getCorrelationId()).not.toBe(id);
  });
});

describe('enterContext', () => {
  it('adds identity for the rest of the request', () => {
    runWithContext(context, () => {
      expect(getOrganizationId()).toBeUndefined();

      enterContext({ organizationId: 'org-a', membershipId: 'mem-1' });

      expect(getOrganizationId()).toBe('org-a');
      expect(getContext()?.membershipId).toBe('mem-1');
    });
  });

  it('keeps the correlation id, which is fixed for the life of the request', () => {
    runWithContext(context, () => {
      enterContext({ userId: 'user-1' });
      expect(getContext()?.correlationId).toBe('corr-1');
    });
  });

  it('refuses to run outside a request rather than starting a context nobody opened', () => {
    expect(() => {
      enterContext({ organizationId: 'org-a' });
    }).toThrow(/outside a request context/);
  });
});

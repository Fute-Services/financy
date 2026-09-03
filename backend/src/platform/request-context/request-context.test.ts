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

describe('enterContext across an await boundary', () => {
  /**
   * The regression test for the bug that made `GET /auth/session` return 401
   * after a successful login.
   *
   * `AuthGuard` resolves the session and calls `enterContext`, then Nest awaits
   * the guard and invokes the handler. With `storage.enterWith` the handler saw
   * the pre-guard context and the membership was gone — a silent one, because
   * every symptom pointed at the session lookup instead.
   *
   * This is the exact shape: mutate inside an awaited callee, read from the
   * caller afterwards.
   */
  it('is visible to the caller after the callee resolves', async () => {
    async function guard(): Promise<void> {
      await Promise.resolve();
      enterContext({ organizationId: 'org-a', membershipId: 'mem-1' });
    }

    await runWithContext(context, async () => {
      await guard();

      // The caller's frame, after the awaited callee returned.
      expect(getOrganizationId()).toBe('org-a');
      expect(getContext()?.membershipId).toBe('mem-1');
    });
  });

  it('is visible to a sibling called afterwards, as a handler would be', async () => {
    const seen: Array<string | undefined> = [];

    await runWithContext(context, async () => {
      await (async () => {
        await Promise.resolve();
        enterContext({ organizationId: 'org-b' });
      })();

      await (async () => {
        await Promise.resolve();
        seen.push(getOrganizationId());
      })();
    });

    expect(seen).toEqual(['org-b']);
  });

  it('still does not leak between concurrent requests', async () => {
    const observe = (organizationId: string) =>
      runWithContext({ correlationId: organizationId, startedAt: Date.now() }, async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        enterContext({ organizationId });
        await new Promise((resolve) => setTimeout(resolve, 5));
        return getOrganizationId();
      });

    await expect(Promise.all([observe('org-a'), observe('org-b')])).resolves.toEqual([
      'org-a',
      'org-b',
    ]);
  });
});

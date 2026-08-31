import { AsyncLocalStorage } from 'node:async_hooks';

import { newCorrelationId } from '@financy/core';

/**
 * What every layer below the controller is allowed to know about the caller.
 *
 * `organizationId` is the load-bearing field. It is resolved from the
 * session's membership by `TenantGuard` and **never** from the request body,
 * query, or a header — layer 1 of tenant isolation (docs/08 §4.5). It is
 * carried here rather than passed as a parameter because a parameter can be
 * forgotten at one call site out of two hundred, and the one that forgot is
 * the one that leaks.
 */
export interface RequestContext {
  readonly correlationId: string;
  readonly organizationId?: string;
  readonly membershipId?: string;
  readonly userId?: string;
  readonly sessionId?: string;
  /** Recorded on every audit and security event, so they are attributable. */
  readonly ipAddress?: string;
  readonly userAgent?: string;
  /** When the request entered the process — the basis for its duration. */
  readonly startedAt: number;
}

/**
 * The store holds a **mutable** object, and `enterContext` mutates it.
 *
 * The obvious implementation — `storage.enterWith({ ...current, ...patch })` —
 * is silently wrong here, and cost an afternoon to find. `enterWith` rebinds
 * the store for the current execution and its descendants only; when the
 * `AuthGuard`'s promise resolves and Nest calls the route handler, that handler
 * runs in the *caller's* async context, which still holds the object the
 * middleware created. The guard's organisation and membership vanish between
 * the guard and the controller.
 *
 * Mutating the single object `runWithContext` established for the request
 * makes the change visible everywhere in it, which is what the guards
 * actually need. Isolation is unaffected: each request gets its own object.
 */
type MutableRequestContext = {
  -readonly [K in keyof RequestContext]: RequestContext[K];
};

const storage = new AsyncLocalStorage<MutableRequestContext>();

/** Run `fn` with `context` visible to everything it awaits. */
export function runWithContext<T>(context: RequestContext, fn: () => T): T {
  return storage.run(context, fn);
}

/**
 * The current context, or `undefined` outside a request.
 *
 * `undefined` is a real and legitimate answer: startup code, a scheduled job,
 * and a CLI script all run without one. Callers that require a context —
 * anything touching tenant-scoped data — must say so by failing, not by
 * inventing a default.
 */
export function getContext(): RequestContext | undefined {
  return storage.getStore();
}

/**
 * The caller's organisation, or `undefined`.
 *
 * Passed to the Prisma tenant extension, which fails closed on `undefined`.
 * That is the division of responsibility: this function reports what is true,
 * and the data layer decides that "nothing" is not good enough.
 */
export function getOrganizationId(): string | undefined {
  return storage.getStore()?.organizationId;
}

/**
 * The correlation id, generating one if there is no context.
 *
 * A log line or an error envelope without a correlation id is worse than
 * useless — it looks like it can be traced and cannot — so this never returns
 * empty. A generated id outside a request is still a unique handle for
 * whatever produced it.
 */
export function getCorrelationId(): string {
  return storage.getStore()?.correlationId ?? newCorrelationId();
}

/**
 * Narrow the context for the remainder of the request.
 *
 * Guards use this to attach identity once it is known: `AuthGuard` adds the
 * user and session, `TenantGuard` adds the organisation. It replaces the
 * store's contents rather than nesting a new `run`, so the change is visible
 * to the rest of the request rather than only inside a callback.
 */
export function enterContext(patch: Partial<Omit<RequestContext, 'correlationId'>>): void {
  const current = storage.getStore();

  if (current === undefined) {
    throw new Error('enterContext called outside a request context.');
  }

  Object.assign(current, patch);
}

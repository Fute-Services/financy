import 'server-only';

import { HEADER } from '@financy/contracts';
import { revalidatePath } from 'next/cache';

import { ApiError, apiFetch } from './api';

import { type FormState } from './form-state';

export { IDLE, type FormState } from './form-state';

/**
 * Run a write against the API and turn any failure into a `FormState`.
 *
 * Every mutation in this app goes through here, so that "what does the user
 * see when the server says no" is answered once. The alternative — a
 * `try/catch` per action — is how one of them ends up rendering
 * `[object Object]` six months from now.
 *
 * `paths` are revalidated on success. Next caches server-component renders
 * aggressively, and without this the table the user just edited re-renders
 * from the pre-edit cache and looks like the save was ignored.
 */
export async function runWrite<T>(
  paths: readonly string[],
  write: () => Promise<T>,
  successMessage?: string,
  /**
   * Turns the write's result into extra state for the form.
   *
   * Only invitations use it, to surface the one-time acceptance link. Most
   * writes need nothing from their result — the page re-renders from the
   * server — so the parameter is optional and usually absent.
   */
  describe?: (result: T) => Partial<FormState>,
): Promise<FormState> {
  let result: T;

  try {
    result = await write();
  } catch (error) {
    return toFormState(error);
  }

  for (const path of paths) revalidatePath(path);

  return {
    status: 'success',
    ...(successMessage === undefined ? {} : { message: successMessage }),
    ...(describe === undefined ? {} : describe(result)),
  };
}

export function toFormState(error: unknown): FormState {
  if (!(error instanceof ApiError)) {
    // A network failure, not an API answer. Saying so is more useful than a
    // generic message, which makes people doubt what they typed.
    return {
      status: 'error',
      message: 'Could not reach the server. Check your connection and try again.',
    };
  }

  if (error.fields !== undefined && Object.keys(error.fields).length > 0) {
    return { status: 'error', fields: error.fields, message: error.message };
  }

  if (error.code === 'STALE_VERSION') {
    return {
      status: 'error',
      conflict: true,
      message: 'Someone else changed this while you were editing. Reload to see their version.',
    };
  }

  if (error.code === 'STEP_UP_REQUIRED') {
    return {
      status: 'error',
      message: 'Confirm your password before making this change.',
    };
  }

  // Every other code carries a message written for a person — the API's error
  // taxonomy exists so this does not have to guess.
  return { status: 'error', message: error.message };
}

/** A `PATCH` or `POST` carrying the record version as `If-Match`. */
export async function writeWithVersion<T>(
  path: string,
  method: 'PATCH' | 'POST' | 'DELETE',
  version: number,
  body?: unknown,
): Promise<T> {
  return apiFetch<T>(path, {
    method,
    headers: {
      [HEADER.ifMatch]: String(version),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

/** A create, which has no version to match against. */
export async function create<T>(path: string, body: unknown): Promise<T> {
  return apiFetch<T>(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/**
 * Read a form field, returning `undefined` for a blank one.
 *
 * Blank means "not supplied", which is what an optional field wants; sending
 * `""` instead would fail a `nonEmptyString` on the server and produce a
 * validation error for a field the person deliberately left alone.
 */
export function optional(form: FormData, name: string): string | undefined {
  const value = form.get(name);

  if (typeof value !== 'string') return undefined;

  const trimmed = value.trim();

  return trimmed === '' ? undefined : trimmed;
}

/**
 * Read a field where blank means "clear it".
 *
 * The counterpart to `optional`, for the fields whose contract distinguishes
 * `null` from absent — `legalName`, a department's `code`, a project's dates.
 * Collapsing the two would make "remove this value" impossible to express
 * through a form, which is the more common intent of clearing a box.
 */
export function nullable(form: FormData, name: string): string | null | undefined {
  const value = form.get(name);

  if (typeof value !== 'string') return undefined;

  const trimmed = value.trim();

  return trimmed === '' ? null : trimmed;
}

/**
 * A required text field, as a string.
 *
 * `FormData.get` can return a `File`, so interpolating its result into a URL
 * produces `[object Object]` and a request against a path that does not
 * exist. Narrowing here means every call site gets a string or an error,
 * rather than one of them silently producing a 404 nobody can explain.
 */
export function text(form: FormData, name: string): string {
  const value = form.get(name);

  if (typeof value !== 'string' || value === '') {
    throw new Error(`This form is missing its "${name}" field.`);
  }

  return value;
}

/** The record version a form carries in a hidden input. */
export function version(form: FormData): number {
  const raw = form.get('version');
  const parsed = Number.parseInt(typeof raw === 'string' ? raw : '', 10);

  // A form without one is a bug in the form, not a request to be answered —
  // and sending a guess would defeat the precondition entirely.
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error('This form is missing the record version it was rendered from.');
  }

  return parsed;
}

'use server';

import type {
  DepartmentRecord,
  EntityRecord,
  OrganizationSummary,
  Resource,
} from '@financy/contracts';

import {
  create,
  nullable,
  optional,
  runWrite,
  text,
  version,
  writeWithVersion,
  type FormState,
} from '@/lib/actions';

/**
 * The settings screen's writes.
 *
 * Server actions rather than a client fetch layer, deliberately. The session
 * cookie is `httpOnly` and never reaches browser JavaScript; a client-side
 * mutation would need a proxy route per endpoint, and each proxy is a place
 * where a permission check can be forgotten. An action runs on the server,
 * inherits the caller's cookie from the request it is part of, and calls the
 * API exactly as a page render does.
 *
 * **Nothing here validates.** The API owns every rule — the currency lock,
 * the last-entity guard, the version precondition — and duplicating one here
 * would create a second place to be wrong. These functions read a `FormData`,
 * shape a request, and hand the answer back.
 */

const SETTINGS = '/settings/organization';

export async function updateOrganization(_previous: FormState, form: FormData): Promise<FormState> {
  return runWrite(
    [SETTINGS],
    () =>
      writeWithVersion<Resource<OrganizationSummary>>('/organization', 'PATCH', version(form), {
        name: optional(form, 'name'),
        // `nullable`, not `optional`: an empty legal-name box means "we do not
        // have one", and the contract distinguishes that from "leave it alone".
        legalName: nullable(form, 'legalName'),
        countryCode: optional(form, 'countryCode'),
        timezone: optional(form, 'timezone'),
        fiscalYearStartMonth: Number(form.get('fiscalYearStartMonth')),
      }),
    'Organisation updated.',
  );
}

export async function createEntity(_previous: FormState, form: FormData): Promise<FormState> {
  return runWrite(
    [SETTINGS],
    () =>
      create<Resource<EntityRecord>>('/entities', {
        name: optional(form, 'name'),
        countryCode: optional(form, 'countryCode'),
        functionalCurrency: optional(form, 'functionalCurrency'),
        registrationNumber: nullable(form, 'registrationNumber'),
      }),
    'Entity created.',
  );
}

export async function updateEntity(_previous: FormState, form: FormData): Promise<FormState> {
  const id = text(form, 'id');

  return runWrite(
    [SETTINGS],
    () =>
      writeWithVersion<Resource<EntityRecord>>(`/entities/${id}`, 'PATCH', version(form), {
        name: optional(form, 'name'),
        countryCode: optional(form, 'countryCode'),
        functionalCurrency: optional(form, 'functionalCurrency'),
        registrationNumber: nullable(form, 'registrationNumber'),
      }),
    'Entity updated.',
  );
}

/**
 * Archive or restore, chosen by the form rather than by two actions.
 *
 * The API refuses an archive that would leave the organisation with no active
 * entity, and that refusal arrives here as an ordinary message — the button
 * does not try to predict it. A client-side guess would be wrong the moment
 * another administrator archived something in the meantime.
 */
export async function setEntityArchived(_previous: FormState, form: FormData): Promise<FormState> {
  const id = text(form, 'id');
  const archived = form.get('archived') === 'true';

  return runWrite(
    [SETTINGS],
    () =>
      writeWithVersion<Resource<EntityRecord>>(
        `/entities/${id}/${archived ? 'archive' : 'restore'}`,
        'POST',
        version(form),
      ),
    archived ? 'Entity archived.' : 'Entity restored.',
  );
}

// ── departments ────────────────────────────────────────────────────────────

export async function createDepartment(_previous: FormState, form: FormData): Promise<FormState> {
  return runWrite(
    [SETTINGS],
    () =>
      create<Resource<DepartmentRecord>>('/departments', {
        name: optional(form, 'name'),
        // `nullable`: an empty parent select means "make this a root", which
        // is a different instruction from "leave the parent alone".
        parentId: nullable(form, 'parentId'),
        code: nullable(form, 'code'),
      }),
    'Department created.',
  );
}

export async function updateDepartment(_previous: FormState, form: FormData): Promise<FormState> {
  const id = text(form, 'id');

  return runWrite(
    [SETTINGS],
    () =>
      writeWithVersion<Resource<DepartmentRecord>>(`/departments/${id}`, 'PATCH', version(form), {
        name: optional(form, 'name'),
        parentId: nullable(form, 'parentId'),
        code: nullable(form, 'code'),
      }),
    'Department updated.',
  );
}

/**
 * Archiving refuses while the department still has live children or active
 * members, and the API says which. That refusal arrives here as an ordinary
 * message rather than being predicted client-side — a prediction would go
 * stale the moment somebody else moved a person.
 */
export async function setDepartmentArchived(
  _previous: FormState,
  form: FormData,
): Promise<FormState> {
  const id = text(form, 'id');
  const archived = form.get('archived') === 'true';

  return runWrite(
    [SETTINGS],
    () =>
      writeWithVersion<Resource<DepartmentRecord>>(
        `/departments/${id}/${archived ? 'archive' : 'restore'}`,
        'POST',
        version(form),
      ),
    archived ? 'Department archived.' : 'Department restored.',
  );
}

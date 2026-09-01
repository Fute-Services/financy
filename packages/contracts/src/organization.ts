/**
 * `/v1/organization` — the organisation and its structure (docs/10 §5.4).
 *
 * One endpoint returning the organisation with its entities, departments, and
 * categories, rather than four. The settings screen shows all of it at once and
 * none of it is large, so four round trips would buy nothing but four chances
 * to render half a page.
 */

import { z } from 'zod';

import {
  currencyCodeSchema,
  idSchema,
  nonEmptyString,
  slugSchema,
  timestampSchema,
  versionSchema,
} from './primitives.js';

/**
 * ISO 3166-1 alpha-2, upper-cased.
 *
 * Not validated against a list of real countries: the list changes, a stale
 * copy rejects a legitimate value, and the failure mode is a customer unable
 * to finish registration. Shape only.
 */
export const countryCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{2}$/, { message: 'Country must be a two-letter ISO 3166-1 code.' });

/**
 * Mirrors the `EntityStatus` enum in the schema — two states, not three.
 * A test in `@financy/db`, which may import both, asserts the lists match.
 */
export const ENTITY_STATUSES = ['ACTIVE', 'ARCHIVED'] as const;
export type EntityStatus = (typeof ENTITY_STATUSES)[number];

export const organizationSummarySchema = z.object({
  id: idSchema,
  slug: slugSchema,
  name: nonEmptyString(200),
  legalName: z.string().max(200).nullable(),
  /**
   * Locked once any financial record exists (docs/09 §4.2). The flag travels
   * with the value so the form can say *why* the field is disabled, rather
   * than presenting a greyed-out box with no explanation.
   */
  baseCurrency: currencyCodeSchema,
  baseCurrencyLocked: z.boolean(),
  countryCode: countryCodeSchema,
  timezone: nonEmptyString(64),
  fiscalYearStartMonth: z.int().min(1).max(12),
  /**
   * Sent straight back as `If-Match` on the next `PATCH`. Without it on the
   * read, the settings screen would have to guess a version or issue a second
   * request to learn one, and a guessed precondition is no precondition.
   */
  version: versionSchema,
  createdAt: timestampSchema,
});

export const entitySummarySchema = z.object({
  id: idSchema,
  name: nonEmptyString(200),
  registrationNumber: z.string().max(100).nullable(),
  countryCode: countryCodeSchema,
  functionalCurrency: currencyCodeSchema,
  status: z.enum(ENTITY_STATUSES),
});

export const departmentNodeSchema = z.object({
  id: idSchema,
  parentId: idSchema.nullable(),
  name: nonEmptyString(200),
  code: z.string().max(50).nullable(),
  /**
   * `/root-id/child-id/` — materialised, so a subtree is one `startsWith`
   * rather than a recursive query (docs/09 §7.6).
   */
  path: z.string(),
  /** Depth in the tree, derived from `path`. The UI indents by it. */
  depth: z.int().min(0),
  memberCount: z.int().min(0),
});

export const categoryNodeSchema = z.object({
  id: idSchema,
  parentId: idSchema.nullable(),
  key: nonEmptyString(100),
  name: nonEmptyString(200),
  /** System categories cannot be renamed or removed; the UI must not offer to. */
  isSystem: z.boolean(),
  depth: z.int().min(0),
});

export const organizationSettingsSchema = z.object({
  organization: organizationSummarySchema,
  entities: z.array(entitySummarySchema),
  departments: z.array(departmentNodeSchema),
  categories: z.array(categoryNodeSchema),
  /** How many people hold each role, so the roles table is not a bare list. */
  roleCounts: z.array(
    z.object({
      key: nonEmptyString(50),
      name: nonEmptyString(100),
      description: z.string().nullable(),
      memberCount: z.int().min(0),
      permissionCount: z.int().min(0),
    }),
  ),
});

export type OrganizationSummary = z.infer<typeof organizationSummarySchema>;
export type EntitySummary = z.infer<typeof entitySummarySchema>;
export type DepartmentNode = z.infer<typeof departmentNodeSchema>;
export type CategoryNode = z.infer<typeof categoryNodeSchema>;
export type OrganizationSettings = z.infer<typeof organizationSettingsSchema>;

/**
 * Depth from a materialised path.
 *
 * `/a/` is depth 0, `/a/b/` is depth 1. Shared by the API (which computes it)
 * and any client that needs to re-derive it after a local edit, so that the
 * two cannot disagree about what indentation a row gets.
 */
export function depthOfPath(path: string): number {
  const segments = path.split('/').filter((segment) => segment !== '');
  return Math.max(0, segments.length - 1);
}

// ═══════════════════════════════════════════════════════════════════════════
//  Writes (docs/10 §5.4)
//
//  Every one of these is a PATCH or POST carrying `If-Match: <version>`. The
//  version is not decoration: two administrators editing the settings screen
//  at once is the ordinary case, not the exotic one, and a last-write-wins
//  save discards the other's change with no trace that it ever existed.
//
//  Each schema is `strictObject`, so an unknown key is a 422 rather than a
//  field the server silently ignores. `organizationId`, `version`, and
//  `createdAt` are deliberately absent from all of them — they are the
//  server's to set, and a body that could carry them is a body that invites
//  a client to try.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * At least one field, so an empty PATCH is a 422 rather than a write that
 * burns a version and records an audit event describing no change.
 *
 * Counts *defined* values, not keys. `{ legalName: undefined }` has a key and
 * no instruction in it — the services skip an undefined field — so counting
 * keys would let it through as a write that changes nothing while still
 * incrementing the version and invalidating every other client's `If-Match`.
 * JSON cannot express it, but a client building the body in TypeScript
 * (`{ legalName: form.legalName || undefined }`) does so constantly.
 */
const atLeastOneField = (value: object): boolean =>
  Object.values(value).some((field) => field !== undefined);

const AT_LEAST_ONE = { message: 'Supply at least one field to change.' } as const;

/**
 * `PATCH /v1/organization`.
 *
 * `slug` is absent on purpose. It appears in URLs and, from Phase 5, in
 * documents sent to vendors; renaming it silently breaks every link anyone
 * saved. If it ever becomes editable it needs a redirect story first.
 *
 * `baseCurrency` is present but conditional: the service refuses the change
 * with `409 CURRENCY_LOCKED` once any financial record exists (docs/10 §5.4),
 * because re-denominating an organisation's history is not a settings change.
 */
export const updateOrganizationSchema = z
  .strictObject({
    name: nonEmptyString(200).optional(),
    /** `null` clears it; omitted leaves it alone. The two are not the same. */
    legalName: z.string().trim().max(200).nullable().optional(),
    baseCurrency: currencyCodeSchema.optional(),
    countryCode: countryCodeSchema.optional(),
    timezone: nonEmptyString(64).optional(),
    fiscalYearStartMonth: z.int().min(1).max(12).optional(),
  })
  .refine(atLeastOneField, AT_LEAST_ONE);

/** `POST /v1/entities`. */
export const createEntitySchema = z.strictObject({
  name: nonEmptyString(200),
  registrationNumber: z.string().trim().max(100).nullable().optional(),
  countryCode: countryCodeSchema,
  /**
   * May differ from the organisation's base currency — that is the entire
   * reason entities exist. Consolidation converts at report time (docs/15).
   */
  functionalCurrency: currencyCodeSchema,
});

/**
 * `PATCH /v1/entities/{id}`.
 *
 * `functionalCurrency` is editable here only while the entity has no
 * financial records; the service applies the same lock as the organisation's
 * base currency, for the same reason.
 */
export const updateEntitySchema = z
  .strictObject({
    name: nonEmptyString(200).optional(),
    registrationNumber: z.string().trim().max(100).nullable().optional(),
    countryCode: countryCodeSchema.optional(),
    functionalCurrency: currencyCodeSchema.optional(),
  })
  .refine(atLeastOneField, AT_LEAST_ONE);

export type UpdateOrganization = z.infer<typeof updateOrganizationSchema>;
export type CreateEntity = z.infer<typeof createEntitySchema>;
export type UpdateEntity = z.infer<typeof updateEntitySchema>;

/**
 * An entity as returned by a write, which is `entitySummarySchema` plus the
 * `version` the caller must send back in the next `If-Match`.
 *
 * The version travels in the body rather than only in an `ETag` header
 * because the settings screen holds several entities at once and would
 * otherwise need a header per row, which HTTP does not offer.
 */
export const entityRecordSchema = entitySummarySchema.extend({
  version: versionSchema,
  archivedAt: timestampSchema.nullable(),
});

export type EntityRecord = z.infer<typeof entityRecordSchema>;

// ═══════════════════════════════════════════════════════════════════════════
//  Departments (docs/10 §5.4, task 1.5.3)
//
//  A tree with a materialised `path`, so a subtree is one `startsWith` rather
//  than a recursive query. Neither `path` nor `depth` appears in any write
//  schema: both are derived from `parentId`, and a client that could send a
//  path could send one that disagrees with the parent it also sent — leaving
//  the server to pick a winner, with no correct choice available.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * A short human code — `ENG`, `FIN-EU`. Optional, and unique within the
 * organisation *when set*.
 *
 * Uniqueness is enforced by the service rather than a unique index, because
 * MongoDB treats every missing value in a unique index as the same value: an
 * organisation could then have exactly one department without a code, which
 * is not a rule anybody asked for (see the schema comment on `departments`).
 */
export const departmentCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .max(50)
  .regex(/^[A-Z0-9][A-Z0-9-]*$/, {
    message: 'A code may use letters, digits, and hyphens, and must not start with a hyphen.',
  });

export const createDepartmentSchema = z.strictObject({
  name: nonEmptyString(200),
  /** `null` or omitted makes it a root. */
  parentId: idSchema.nullable().optional(),
  code: departmentCodeSchema.nullable().optional(),
  /**
   * The membership that heads the department. Validated against the caller's
   * own organisation by the service — an id from another tenant is a 404, not
   * a 403, so a caller cannot use this field to probe for one.
   */
  headMembershipId: idSchema.nullable().optional(),
});

/**
 * `PATCH /v1/departments/{id}`.
 *
 * `parentId` is here, so re-parenting is an edit rather than a delete and a
 * re-create — the latter would break every membership pointing at the old row
 * and lose the department's audit history. Moving a node rewrites the `path`
 * of its whole subtree, which the service does in the same transaction.
 */
export const updateDepartmentSchema = z
  .strictObject({
    name: nonEmptyString(200).optional(),
    parentId: idSchema.nullable().optional(),
    code: departmentCodeSchema.nullable().optional(),
    headMembershipId: idSchema.nullable().optional(),
  })
  .refine(atLeastOneField, AT_LEAST_ONE);

/**
 * A department as returned by `/v1/departments`: the node plus the head, the
 * archive state, and the `If-Match` version.
 *
 * `memberCount` is deliberately **not** here. The settings payload carries it
 * because that read is already loading every membership to tally roles and
 * gets the count for nothing; this endpoint answers "what is the tree" and
 * would have to issue a second query to invent it. A field that is present
 * but always zero is worse than an absent one — a client cannot tell the
 * placeholder from a department that genuinely has nobody in it.
 */
export const departmentRecordSchema = departmentNodeSchema.omit({ memberCount: true }).extend({
  headMembershipId: idSchema.nullable(),
  version: versionSchema,
  archivedAt: timestampSchema.nullable(),
});

export type CreateDepartment = z.infer<typeof createDepartmentSchema>;
export type UpdateDepartment = z.infer<typeof updateDepartmentSchema>;
export type DepartmentRecord = z.infer<typeof departmentRecordSchema>;

/**
 * The path a department gets under a given parent.
 *
 * Shared by the service, which writes it, and any client that re-derives a
 * subtree locally after a move rather than refetching. Both ends delimited:
 * an undelimited path makes `/a/bc/` match a query for `/a/b/`, which
 * silently widens a manager's scope to a department they do not manage.
 */
export function pathUnder(parentPath: string | null, id: string): string {
  return `${parentPath ?? '/'}${id}/`;
}

/**
 * Whether `candidate` lies inside the subtree rooted at `ancestorPath`.
 *
 * The cycle check: re-parenting a node beneath its own descendant would
 * detach that subtree from the tree entirely, and — because the path rewrite
 * walks downwards — loop while doing it.
 */
export function isWithinSubtree(candidatePath: string, ancestorPath: string): boolean {
  return candidatePath.startsWith(ancestorPath);
}

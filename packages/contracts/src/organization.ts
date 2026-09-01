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

/**
 * `/v1/projects` and `/v1/categories` — the two dimensions spend is coded to
 * (docs/10 §5.4, task 1.5.4).
 *
 * They live in one module because they are the same kind of thing from the
 * API's point of view: small, tenant-scoped reference data that transactions
 * point at, archived rather than deleted, and edited from the same settings
 * screen. What they are *not* is the same permission — projects follow the
 * department tree (`department:manage`), categories follow policy
 * (`policy:manage`), because a policy branches on a category and re-coding
 * the taxonomy silently changes what every policy decides.
 */

import { z } from 'zod';

import { idSchema, nonEmptyString, timestampSchema, versionSchema } from './primitives.js';

/** Mirrors the `ProjectStatus` enum in the schema. Two states, not three. */
export const PROJECT_STATUSES = ['ACTIVE', 'CLOSED'] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

const atLeastOneField = (value: object): boolean =>
  Object.values(value).some((field) => field !== undefined);

const AT_LEAST_ONE = { message: 'Supply at least one field to change.' } as const;

/**
 * A short human code — `APOLLO`, `Q3-MIGRATION`. Optional, and unique within
 * the organisation *when set*, for the same reason department codes are:
 * MongoDB treats every absent value in a unique index as the same value, so
 * an index would allow exactly one uncoded project.
 */
export const projectCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .max(50)
  .regex(/^[A-Z0-9][A-Z0-9-]*$/, {
    message: 'A code may use letters, digits, and hyphens, and must not start with a hyphen.',
  });

export const projectRecordSchema = z.object({
  id: idSchema,
  name: nonEmptyString(200),
  code: z.string().max(50).nullable(),
  entityId: idSchema.nullable(),
  departmentId: idSchema.nullable(),
  status: z.enum(PROJECT_STATUSES),
  startsOn: z.iso.date().nullable(),
  endsOn: z.iso.date().nullable(),
  archivedAt: timestampSchema.nullable(),
  version: versionSchema,
});

const projectWritableFields = {
  name: nonEmptyString(200),
  code: projectCodeSchema.nullable().optional(),
  /** Which legal entity the spend lands on. Null means the organisation. */
  entityId: idSchema.nullable().optional(),
  departmentId: idSchema.nullable().optional(),
  /**
   * Dates, not timestamps. A project starting "on the 3rd" starts on the 3rd
   * in the organisation's timezone, and storing an instant makes that depend
   * on where the person creating it happened to be.
   */
  startsOn: z.iso.date().nullable().optional(),
  endsOn: z.iso.date().nullable().optional(),
};

/**
 * A project's window must not end before it starts.
 *
 * Checked on both the create and the update schema, but the update can only
 * see the fields it was sent — a PATCH moving just `endsOn` to before an
 * existing `startsOn` is caught by the service, which has both.
 */
const endsAfterStart = (value: {
  startsOn?: string | null | undefined;
  endsOn?: string | null | undefined;
}): boolean => {
  const { startsOn, endsOn } = value;

  if (startsOn === undefined || startsOn === null) return true;
  if (endsOn === undefined || endsOn === null) return true;

  // Both are `YYYY-MM-DD`, so a string comparison is a date comparison —
  // and one that cannot be thrown off by a timezone the way `new Date()` can.
  return endsOn >= startsOn;
};

const WINDOW_ORDER = { message: 'A project cannot end before it starts.' } as const;

export const createProjectSchema = z
  .strictObject(projectWritableFields)
  .refine(endsAfterStart, WINDOW_ORDER);

export const updateProjectSchema = z
  .strictObject({ ...projectWritableFields, name: projectWritableFields.name.optional() })
  .refine(atLeastOneField, AT_LEAST_ONE)
  .refine(endsAfterStart, WINDOW_ORDER);

export type ProjectRecord = z.infer<typeof projectRecordSchema>;
export type CreateProject = z.infer<typeof createProjectSchema>;
export type UpdateProject = z.infer<typeof updateProjectSchema>;

// ═══════════════════════════════════════════════════════════════════════════
//  Categories
// ═══════════════════════════════════════════════════════════════════════════

/**
 * The stable identifier a policy refers to. Lower-case, snake-cased.
 *
 * **Create-only, and that is the whole point.** A policy rule says "airfare
 * over 500 needs finance approval" by naming `travel_airfare`; letting the
 * key be edited would silently change what every policy referring to it
 * decides, with nothing in the policy's own history to show why. The
 * *display name* is editable, which is what people actually want to change.
 */
export const categoryKeySchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1)
  .max(100)
  .regex(/^[a-z0-9][a-z0-9_]*$/, {
    message: 'A key may use lower-case letters, digits, and underscores, and must start with one.',
  });

export const categoryRecordSchema = z.object({
  id: idSchema,
  parentId: idSchema.nullable(),
  key: categoryKeySchema,
  name: nonEmptyString(200),
  /** Seeded rows. They may be archived, but never renamed or re-keyed. */
  isSystem: z.boolean(),
  depth: z.int().min(0).max(1),
  archivedAt: timestampSchema.nullable(),
  version: versionSchema,
});

export const createCategorySchema = z.strictObject({
  key: categoryKeySchema,
  name: nonEmptyString(200),
  /**
   * `null` or omitted makes a top-level category. A parent that is itself a
   * child is refused by the service: the tree is two levels deep by design
   * (see `DEFAULT_CATEGORIES`), because one level forces "Travel" to absorb
   * airfare and mileage, and a deeper taxonomy is a chart of accounts — a
   * different artefact, with a different owner, in Phase 6.
   */
  parentId: idSchema.nullable().optional(),
});

/**
 * `PATCH /v1/categories/{id}` — the display name, and nothing else.
 *
 * Not the key, which policies name. Not the parent: moving a category between
 * branches changes what every historical transaction coded to it appears to
 * have been, and re-coding history is not an edit to a lookup table.
 */
export const updateCategorySchema = z
  .strictObject({ name: nonEmptyString(200).optional() })
  .refine(atLeastOneField, AT_LEAST_ONE);

export type CategoryRecord = z.infer<typeof categoryRecordSchema>;
export type CreateCategory = z.infer<typeof createCategorySchema>;
export type UpdateCategory = z.infer<typeof updateCategorySchema>;

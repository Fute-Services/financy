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

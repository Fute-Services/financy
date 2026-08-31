/**
 * `@financy/db` — the only package permitted to import `@prisma/client`.
 *
 * Everything else reaches the database through a repository, which receives a
 * tenant-scoped client from this package. That is not a style preference: it
 * is what makes "every query carries an organisation predicate" a property of
 * the data-access layer rather than a habit each author has to remember
 * (ADR-0003, docs/08 §4.3).
 */

export {
  createPrismaClient,
  withTenantScope,
  type LogEvent,
  type PrismaClientOptions,
  type TenantScopedPrismaClient,
} from './client.js';

export { tenantExtension, type OrganizationResolver } from './tenancy/tenant-extension.js';

export { applyTenantScope, TENANT_COLUMN, type TenantScopeInput } from './tenancy/tenant-scope.js';

export {
  classifyModel,
  GLOBAL_MODELS,
  TENANT_SCOPED_MODELS,
  type ModelClassification,
} from './tenancy/model-registry.js';

export { UnclassifiedModelError, UnscopedOperationError } from './tenancy/errors.js';

export { provisionOrganizationRoles, type RoleProvisionResult } from './seed/roles.js';

export { loadWorkspaceEnv } from './workspace-env.js';

export { Prisma, PrismaClient } from '@prisma/client';

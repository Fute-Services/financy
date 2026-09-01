/**
 * `@financy/contracts` — the API contract in executable form.
 *
 * One Zod schema per shape, validated on the server and inferred as a type on
 * the client. That is the point of the package: a contract that only exists in
 * prose drifts, and the drift is discovered by a user rather than by a build.
 *
 * Phase 0 ships the shared foundations — envelopes, errors, pagination,
 * filters, primitives. Endpoint schemas arrive with the endpoints, alongside
 * the module that serves them.
 *
 * Nothing here may import NestJS, Next.js, Prisma, or any provider SDK. The
 * contract is shared by both applications, so it belongs to neither.
 */

export * from './primitives.js';
export * from './permissions.js';
export * from './categories.js';
export * from './auth.js';
export * from './people.js';
export * from './organization.js';
export * from './projects.js';
export * from './policy.js';
export * from './policy-admin.js';
export * from './spend.js';
export * from './approvals.js';
export * from './audit.js';
export * from './errors.js';
export * from './pagination.js';
export * from './envelope.js';
export * from './filters.js';
export * from './headers.js';
export * from './health.js';

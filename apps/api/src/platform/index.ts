/**
 * The platform layer: cross-cutting machinery with no business logic in it.
 *
 * Everything here answers a question every module asks — who is calling, what
 * organisation are they in, how is this configured, where do errors go — and
 * none of it knows what a spend request is. That separation is what lets a
 * domain module be tested without booting the framework.
 */

export * from './audit/index.js';
export * from './authorization/index.js';
export * from './concurrency/index.js';
export * from './config/index.js';
export * from './crypto/index.js';
export * from './database/index.js';
export * from './errors/index.js';
export * from './health/index.js';
export * from './logging/index.js';
export * from './request-context/index.js';
export * from './validation/index.js';

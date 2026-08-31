/**
 * Health contracts.
 *
 * Two endpoints, because they answer different questions and a single one
 * conflates them (docs/17 §6):
 *
 * - **`/health/live`** — is the process alive? Never touches a dependency. A
 *   liveness probe that checks the database restarts every instance when the
 *   database blips, turning a recoverable incident into an outage.
 * - **`/health/ready`** — can this instance serve traffic? Checks the
 *   dependencies it genuinely cannot work without, so the load balancer stops
 *   sending it work instead of the caller receiving errors.
 */

import { z } from 'zod';

import { timestampSchema } from './primitives.js';

export const healthStatusSchema = z.enum(['ok', 'degraded', 'down']);
export type HealthStatus = z.infer<typeof healthStatusSchema>;

export const dependencyHealthSchema = z.object({
  name: z.string(),
  status: healthStatusSchema,
  /** Round-trip time of the probe. Absent when the check did not run. */
  latencyMs: z.number().optional(),
  /** Which adapter answered — `inline` vs `bullmq`, `local` vs `s3`. */
  adapter: z.string().optional(),
  /** Present only when the check failed, and never carries internals. */
  message: z.string().optional(),
  /**
   * Whether a failure here should take the instance out of rotation. The
   * queue on the inline adapter, for example, is reported but not required.
   */
  required: z.boolean(),
});

export const livenessResponseSchema = z.object({
  status: z.literal('ok'),
  uptimeSeconds: z.number(),
  checkedAt: timestampSchema,
});

export const readinessResponseSchema = z.object({
  status: healthStatusSchema,
  version: z.string(),
  appEnv: z.string(),
  checkedAt: timestampSchema,
  dependencies: z.array(dependencyHealthSchema),
});

export type DependencyHealth = z.infer<typeof dependencyHealthSchema>;
export type LivenessResponse = z.infer<typeof livenessResponseSchema>;
export type ReadinessResponse = z.infer<typeof readinessResponseSchema>;

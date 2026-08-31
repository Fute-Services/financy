/**
 * Response envelopes (docs/10 §3).
 *
 * Every response is wrapped. A bare array or a bare object leaves nowhere to
 * put pagination or a correlation id without a breaking change later, and the
 * correlation id is the only handle support has when a caller reports that
 * "it failed".
 */

import { z } from 'zod';

import {
  cursorPaginationSchema,
  offsetPaginationSchema,
  type CursorPagination,
  type OffsetPagination,
} from './pagination.js';
import { correlationIdSchema } from './primitives.js';

export const metaSchema = z.object({
  correlationId: correlationIdSchema,
});

export type ResponseMeta = z.infer<typeof metaSchema>;

export function resourceEnvelope<T extends z.ZodType>(data: T) {
  return z.object({ data, meta: metaSchema });
}

export function cursorCollectionEnvelope<T extends z.ZodType>(item: T) {
  return z.object({
    data: z.array(item),
    pagination: cursorPaginationSchema,
    meta: metaSchema,
  });
}

export function offsetCollectionEnvelope<T extends z.ZodType>(item: T) {
  return z.object({
    data: z.array(item),
    pagination: offsetPaginationSchema,
    meta: metaSchema,
  });
}

export interface Resource<T> {
  data: T;
  meta: ResponseMeta;
}

export interface CursorCollection<T> {
  data: T[];
  pagination: CursorPagination;
  meta: ResponseMeta;
}

export interface OffsetCollection<T> {
  data: T[];
  pagination: OffsetPagination;
  meta: ResponseMeta;
}

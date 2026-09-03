import { HEADER, ifMatchSchema } from '@financy/contracts';
import { ValidationError } from '@financy/core';
import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

/**
 * `@IfMatch()` — the record version the caller believes it is editing.
 *
 * Optimistic concurrency is a header rather than a body field on purpose. It
 * is a precondition on the request, not data being written, and putting it in
 * the body means every write schema has to carry a `version` the client could
 * plausibly leave stale, omit, or invent (docs/09 §1.7).
 *
 * **Mandatory on every write to a versioned record**, which is why this throws
 * rather than returning `undefined`. An optional precondition is one a client
 * forgets, and the failure it prevents — one administrator's save silently
 * discarding another's — is invisible when it happens. Better a 422 the first
 * time the endpoint is called from a new client than a lost edit in month
 * three.
 *
 * `If-Match: 7`, not `If-Match: "W/\"abc\""`. The value is the integer
 * `version` column; the API does not compute entity tags and never promises
 * the header is an RFC 9110 ETag.
 */
export const IfMatch = createParamDecorator((_data: unknown, context: ExecutionContext): number => {
  const request = context.switchToHttp().getRequest<Request>();
  const raw = request.headers[HEADER.ifMatch];

  // Express gives an array when a header is repeated. Picking the first would
  // let a client send `If-Match: 1, If-Match: 9` and have the server choose;
  // there is no correct choice, so it is a bad request.
  if (typeof raw !== 'string') {
    throw new ValidationError({
      'if-match': [
        'Required. Send the version from the record you read, so a concurrent edit cannot be silently overwritten.',
      ],
    });
  }

  const parsed = ifMatchSchema.safeParse(raw);

  if (!parsed.success) {
    throw new ValidationError({
      'if-match': [`Must be the record version, as an integer. Received ${JSON.stringify(raw)}.`],
    });
  }

  return parsed.data;
});

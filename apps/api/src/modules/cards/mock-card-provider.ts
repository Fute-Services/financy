import { randomInt } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import type { CardProvider, IssueCardRequest, IssuedCard } from './card-provider.js';

/**
 * The mock issuer (task 2.4.2, ADR-0014).
 *
 * ## It is a stub, and it says so everywhere
 *
 * `name` is `'mock'`, it is recorded on every card, and the session payload
 * carries `isSandbox: true` so the UI can say it out loud. A mock that
 * presented itself as a real issuer is how a demo becomes a production
 * incident.
 *
 * ## The four digits are random and mean nothing
 *
 * They exist so the UI has something to render in the shape it will eventually
 * render, and so a screen built against this does not have to change when a
 * real issuer arrives. They are not derived from anything and no code may treat
 * them as identifying.
 *
 * ## Every method succeeds
 *
 * Deliberately, and it is the mock's main limitation. A real issuer rejects a
 * limit above a programme ceiling, refuses to freeze an already-terminated
 * card, and times out. The service layer handles those as `CardProvider`
 * rejections; nothing here produces one, so the failure paths are exercised by
 * unit tests against a stubbed provider rather than by this.
 */
@Injectable()
export class MockCardProvider implements CardProvider {
  readonly name = 'mock';

  async issue(request: IssueCardRequest): Promise<IssuedCard> {
    const now = new Date();

    return Promise.resolve({
      // Prefixed, so a provider id in a log or a database is instantly
      // identifiable as one that never came from an issuer.
      providerCardId: `mock_${request.cardId}`,
      lastFour: String(randomInt(0, 10_000)).padStart(4, '0'),
      expiryMonth: now.getUTCMonth() + 1,
      // Three years, which is an ordinary card life and keeps the expiry from
      // being the thing that breaks a long-running demo.
      expiryYear: now.getUTCFullYear() + 3,
      status: 'ACTIVE',
    });
  }

  async freeze(): Promise<void> {
    return Promise.resolve();
  }

  async unfreeze(): Promise<void> {
    return Promise.resolve();
  }

  async terminate(): Promise<void> {
    return Promise.resolve();
  }

  async setLimit(): Promise<void> {
    return Promise.resolve();
  }
}

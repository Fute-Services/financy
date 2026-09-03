import type { LimitPeriod } from '@financy/contracts';

/**
 * The card issuer, as a port (task 2.4.2, docs/13, ADR-0014).
 *
 * ## Why a port at all, when there is one adapter
 *
 * Because the shape of this interface is a decision about the domain, and it is
 * much cheaper to get wrong now than after a real issuer is behind it. Writing
 * `MockCardProvider` first forced the questions a real integration asks —
 * *what is returned synchronously? what arrives later? what can fail and how?*
 * — at a point where answering them costs an afternoon rather than a migration.
 *
 * ## What this interface refuses to expose
 *
 * There is no method that returns a PAN or a CVV, and no field that could carry
 * one. Not because the mock has none, but because the day a real issuer is
 * wired in, the temptation is to "just pass it through for display" — and an
 * interface with nowhere to put it makes that a change somebody has to argue
 * for rather than one they can make by accident.
 *
 * ## Issuing is asynchronous, and the interface says so
 *
 * A real issuer answers "requested", not "here is your card". The card is
 * `PENDING` until the provider confirms, which is why `IssuedCard` may carry a
 * null `lastFour` — the mock confirms immediately, and code written against it
 * must still handle the case where it does not.
 */

export interface IssueCardRequest {
  readonly organizationId: string;
  readonly cardId: string;
  readonly holderName: string;
  readonly cardType: 'VIRTUAL' | 'PHYSICAL';
  readonly limitAmount: string;
  readonly limitCurrency: string;
  readonly limitPeriod: LimitPeriod;
}

export interface IssuedCard {
  readonly providerCardId: string;
  /** Null while the issuer is still provisioning. Never a full number. */
  readonly lastFour: string | null;
  readonly expiryMonth: number | null;
  readonly expiryYear: number | null;
  readonly status: 'PENDING' | 'ACTIVE';
}

export interface CardProvider {
  readonly name: string;
  issue(request: IssueCardRequest): Promise<IssuedCard>;
  freeze(providerCardId: string): Promise<void>;
  unfreeze(providerCardId: string): Promise<void>;
  /** Permanent at the issuer. There is deliberately no `restore`. */
  terminate(providerCardId: string): Promise<void>;
  setLimit(
    providerCardId: string,
    amount: string,
    currency: string,
    period: LimitPeriod,
  ): Promise<void>;
}

/**
 * The token to inject against. A string rather than the interface, because
 * TypeScript interfaces do not survive to runtime and Nest needs something it
 * can key a provider on.
 */
export const CARD_PROVIDER = Symbol('CARD_PROVIDER');

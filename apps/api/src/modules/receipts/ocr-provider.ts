import type { OcrFields } from '@financy/contracts';

export const OCR_PROVIDER = Symbol('OcrProvider');

/**
 * Reading fields off a receipt (docs/13 §8, FR-EXP-011).
 *
 * **It never blocks submission.** OCR runs after the file is stored, and its
 * output is a suggestion a human accepts or ignores — never the amount. A
 * provider outage must not stop somebody filing an expense, and a number
 * extracted from a photograph must never become the number that gets paid
 * without a person having looked at it.
 */
export interface OcrProvider {
  readonly providerKey: string;
  readonly isSandbox: boolean;

  extract(receiptId: string, contentType: string, data: Uint8Array): Promise<OcrFields | null>;
}

/**
 * The MVP adapter: it reads nothing and says so.
 *
 * `null` rather than empty fields, and the difference matters on screen. Empty
 * fields say "we looked and found nothing", which invites somebody to wonder
 * what is wrong with their photograph; `null` becomes `SKIPPED`, which says
 * nothing looked. A vision service arrives in Phase 7 (docs/13 §2), and until
 * then the honest answer is the absence of one.
 */
export class NoOpOcrProvider implements OcrProvider {
  readonly providerKey = 'noop';
  readonly isSandbox = true;

  extract(): Promise<OcrFields | null> {
    return Promise.resolve(null);
  }
}

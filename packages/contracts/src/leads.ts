/**
 * `/v1/leads` — the demand-request form on the public site.
 *
 * The one endpoint in the API that belongs to nobody. Every other contract in
 * this package describes something inside an organisation; a lead is a person
 * who does not have one yet, which is why the record is global and why the
 * route is `@Public()`.
 *
 * Two consequences fall out of that and both shaped the schema:
 *
 *  - **Nothing here is trusted.** The fields are what an anonymous caller
 *    typed, so every one is bounded and the free-text field is bounded
 *    hardest — an unbounded column reachable without a session is a storage
 *    bill somebody else decides the size of.
 *  - **The response says nothing back.** A public endpoint that echoed the
 *    stored row, or an id, would be a way to confirm what the server kept.
 *    The receipt is a boolean, and the caller learns only that it arrived.
 */

import { z } from 'zod';

import { emailSchema, nonEmptyString, optionalText } from './primitives.js';

/**
 * How the form describes the size of the team, as free text.
 *
 * Deliberately not an enum of bands. The placeholder suggests `50–200`, and
 * somebody will type "about 40, growing fast" — which is more useful to a
 * salesperson than the band it would have been forced into, and refusing it
 * would lose the lead over a dropdown.
 */
const teamSizeSchema = optionalText(80);

export const createLeadSchema = z.strictObject({
  name: nonEmptyString(200),
  email: emailSchema,
  company: nonEmptyString(200),
  teamSize: teamSizeSchema,
  /**
   * "What are you trying to fix?" — the only field worth reading first.
   *
   * 4,000 characters is long enough for anybody describing a real problem and
   * short enough that the field is not a paste target.
   */
  brief: optionalText(4000),
});

/**
 * What a submitter is told: that it arrived.
 *
 * No id, no timestamp, no echo of the input. There is nothing a prospect can
 * do with a lead id, and every field returned from a public write is a field
 * an enumeration script can use to tell a stored submission from a discarded
 * one.
 */
export const leadReceiptSchema = z.strictObject({
  received: z.literal(true),
});

export type CreateLead = z.infer<typeof createLeadSchema>;
export type LeadReceipt = z.infer<typeof leadReceiptSchema>;

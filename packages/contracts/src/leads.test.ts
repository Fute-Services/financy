import { describe, expect, it } from 'vitest';

import { createLeadSchema, leadReceiptSchema } from './leads.js';

const VALID = {
  name: 'Grace Sharma',
  email: 'grace@company.com',
  company: 'Acme Ltd',
  teamSize: '50–200',
  brief: 'Receipts never arrive and closing the month takes a week.',
};

describe('createLeadSchema', () => {
  it('accepts a filled-in form', () => {
    expect(createLeadSchema.parse(VALID)).toMatchObject({
      name: 'Grace Sharma',
      email: 'grace@company.com',
      company: 'Acme Ltd',
    });
  });

  it('accepts the two optional fields being left blank', () => {
    const parsed = createLeadSchema.parse({ ...VALID, teamSize: '', brief: '' });

    // Blank and absent both mean "not set", so neither reaches the database as
    // an empty string that reads like an answer.
    expect(parsed.teamSize).toBeUndefined();
    expect(parsed.brief).toBeUndefined();
  });

  it('lower-cases the address, because there is no citext on MongoDB', () => {
    const parsed = createLeadSchema.parse({ ...VALID, email: 'Grace@Company.COM' });

    // The dedupe lookup matches on this value. Without the transform, two
    // submissions differing only in case would be two leads.
    expect(parsed.email).toBe('grace@company.com');
  });

  it('trims before measuring, so a field of spaces is empty', () => {
    const result = createLeadSchema.safeParse({ ...VALID, name: '   ' });

    expect(result.success).toBe(false);
  });

  it.each(['name', 'email', 'company'] as const)('requires %s', (field) => {
    const result = createLeadSchema.safeParse({ ...VALID, [field]: '' });

    expect(result.success).toBe(false);
  });

  it('rejects an address that is not one', () => {
    expect(createLeadSchema.safeParse({ ...VALID, email: 'grace at company' }).success).toBe(false);
  });

  it('bounds the free-text field', () => {
    // An unbounded text column reachable without a session is a storage bill
    // somebody else decides the size of.
    expect(createLeadSchema.safeParse({ ...VALID, brief: 'x'.repeat(4001) }).success).toBe(false);
    expect(createLeadSchema.safeParse({ ...VALID, brief: 'x'.repeat(4000) }).success).toBe(true);
  });

  it('bounds every other field too', () => {
    expect(createLeadSchema.safeParse({ ...VALID, name: 'x'.repeat(201) }).success).toBe(false);
    expect(createLeadSchema.safeParse({ ...VALID, company: 'x'.repeat(201) }).success).toBe(false);
    expect(createLeadSchema.safeParse({ ...VALID, teamSize: 'x'.repeat(81) }).success).toBe(false);
  });

  it('refuses unknown keys', () => {
    // `strictObject`, so a caller cannot smuggle `source`, `handledAt`, or
    // anything else the API sets for itself.
    expect(createLeadSchema.safeParse({ ...VALID, source: 'spoofed' }).success).toBe(false);
    expect(createLeadSchema.safeParse({ ...VALID, handledAt: new Date() }).success).toBe(false);
  });

  it('names the field it refused, so the form can point at the input', () => {
    const result = createLeadSchema.safeParse({ ...VALID, email: 'nope' });

    expect(result.success).toBe(false);
    if (result.success) return;

    expect(result.error.issues[0]?.path).toEqual(['email']);
  });
});

describe('leadReceiptSchema', () => {
  it('is a constant, and carries nothing derived from the row', () => {
    expect(leadReceiptSchema.parse({ received: true })).toEqual({ received: true });
    expect(leadReceiptSchema.safeParse({ received: true, id: 'anything' }).success).toBe(false);
  });
});

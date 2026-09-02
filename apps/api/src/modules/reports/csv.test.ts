import { describe, expect, it } from 'vitest';

import { escapeCsvField, toCsv } from './csv.js';

/** Written as a code point so this file has no nested-quote puzzles in it. */
const APOSTROPHE = String.fromCharCode(39);

/**
 * The export is a file somebody opens in Excel, and Excel is an interpreter.
 *
 * Every case here is a real payload shape rather than an invented one: merchant
 * names arrive from a card network with no filtering, and the person who opens
 * the file is the one with every record in the organisation on screen.
 */
describe('escapeCsvField', () => {
  it('neutralises the four characters a spreadsheet reads as a formula', () => {
    expect(escapeCsvField('=1+1')).toBe("'=1+1");
    expect(escapeCsvField('+SUM(A1)')).toBe("'+SUM(A1)");
    expect(escapeCsvField('@SUM(1+9)')).toBe("'@SUM(1+9)");

    // The classic Excel command-injection payload, which begins with a minus
    // sign and is therefore the one a naive guard misses.
    const payload = `-2+3+cmd|${APOSTROPHE}/c calc${APOSTROPHE}!A0`;

    expect(escapeCsvField(payload)).toBe(`${APOSTROPHE}${payload}`);
  });

  it('neutralises a formula hidden behind leading whitespace', () => {
    // Excel strips the tab and then sees a formula, so a guard that only
    // looked at the first visible character would pass this straight through.
    const escaped = escapeCsvField('\t=HYPERLINK("http://evil")');

    expect(escaped.startsWith(`"${APOSTROPHE}\t=`)).toBe(true);
    // Quoted as well, because the tab and the quotes both need it.
    expect(escaped).toContain('""http://evil""');
  });
  it('leaves an ordinary merchant name alone', () => {
    expect(escapeCsvField('Blue Bottle Coffee')).toBe('Blue Bottle Coffee');
    expect(escapeCsvField('1234.5000')).toBe('1234.5000');
  });

  it('quotes and doubles, per RFC 4180', () => {
    expect(escapeCsvField('Smith, John')).toBe('"Smith, John"');
    expect(escapeCsvField('He said "no"')).toBe('"He said ""no"""');
    expect(escapeCsvField('two\nlines')).toBe('"two\nlines"');
  });
});

describe('toCsv', () => {
  it('splits money into an amount and a currency column', () => {
    const csv = toCsv(
      [
        { key: 'name', label: 'Department', kind: 'text' },
        { key: 'amount', label: 'Spend', kind: 'money' },
      ],
      [{ name: 'Design', amount: { amount: '1234.5000', currency: 'USD' } }],
    );

    // The amount is unformatted so a spreadsheet can sum it, and the currency
    // is its own column so nobody has to parse a symbol back out of it.
    expect(csv).toContain('Department,Spend,Spend currency');
    expect(csv).toContain('Design,1234.5000,USD');
  });

  it('starts with a byte-order mark, so Excel reads it as UTF-8', () => {
    const csv = toCsv([{ key: 'name', label: 'Name', kind: 'text' }], [{ name: 'Café' }]);

    expect(csv.codePointAt(0)).toBe(0xfeff);
    expect(csv).toContain('Café');
  });

  it('ends every line with CRLF', () => {
    const csv = toCsv([{ key: 'name', label: 'Name', kind: 'text' }], [{ name: 'A' }]);

    expect(csv.endsWith('\r\n')).toBe(true);
    expect(csv.split('\r\n').filter((line) => line !== '')).toHaveLength(2);
  });

  it('writes an empty cell for a missing value rather than the word undefined', () => {
    const csv = toCsv(
      [
        { key: 'name', label: 'Name', kind: 'text' },
        { key: 'by', label: 'By', kind: 'text' },
      ],
      [{ name: 'A', by: null }],
    );

    expect(csv).toContain('A,');
    expect(csv).not.toContain('undefined');
    expect(csv).not.toContain('null');
  });
});

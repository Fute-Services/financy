'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { CardRecord, EntitySummary, ImportResult } from '@financy/contracts';
import { Badge, Button, Dialog, FormMessage } from '@financy/ui';

import { importRows } from './actions';

/**
 * Import a statement.
 *
 * ## The file is parsed here, not on the server
 *
 * A server endpoint taking a CSV would have to guess at the delimiter, the
 * encoding, the date format, and which column is the amount — with nobody to
 * ask — and would report its guesses back as import failures. Parsing in the
 * browser means the person sees the first rows as the parser understood them,
 * says which column is which, and only then are structured rows posted. The
 * guessing still happens; it happens where it can be corrected.
 *
 * ## Re-importing the same file is safe, and that is a property of the API
 *
 * Every row carries the provider's own identifier, and a unique index refuses
 * the second copy. So the honest instruction to somebody who is not sure
 * whether an import worked is "run it again" — which is only honest because the
 * database enforces it rather than a check that races.
 *
 * ## The result is per row
 *
 * "Import complete" is not something anybody can act on. "417 imported, 3
 * already present, 1 failed on row 88 because its entity is archived" is, and
 * it is the difference between fixing one line and re-typing a statement.
 */
export function ImportButton({
  entities,
  cards,
}: {
  entities: readonly EntitySummary[];
  cards: readonly CardRecord[];
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<string[][]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<Mapping>(EMPTY_MAPPING);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [importing, startImport] = useTransition();
  const router = useRouter();

  const activeEntities = entities.filter((entity) => entity.status === 'ACTIVE');
  const [entityId, setEntityId] = useState(activeEntities[0]?.id ?? '');
  const [cardId, setCardId] = useState('');
  const [autoMatch, setAutoMatch] = useState(false);

  function reset(): void {
    setRows([]);
    setHeaders([]);
    setMapping(EMPTY_MAPPING);
    setError(null);
    setResult(null);
  }

  async function onFile(file: File): Promise<void> {
    reset();

    try {
      const text = await file.text();
      const parsed = parseCsv(text);

      if (parsed.length < 2) {
        setError('That file has no rows under its header.');
        return;
      }

      const [header, ...body] = parsed;
      if (header === undefined) return;

      setHeaders(header);
      setRows(body);
      // Guessed from the header names, and every guess is visible and
      // changeable below. A mapping applied silently is a mapping nobody
      // checks until the amounts are wrong.
      setMapping(guessMapping(header));
    } catch {
      setError('That file could not be read as text.');
    }
  }

  function run(): void {
    const problem = validate(mapping, entityId);

    if (problem !== null) {
      setError(problem);
      return;
    }

    startImport(async () => {
      const payload = rows
        .map((row) => toRow(row, mapping, entityId, cardId))
        .filter((row): row is NonNullable<typeof row> => row !== null);

      if (payload.length === 0) {
        setError('No row could be read with this mapping. Check the column choices.');
        return;
      }

      const response = await importRows({
        provider: 'import',
        rows: payload,
        autoMatch,
      });

      setResult(response.result);
      setError(response.error);

      if (response.result !== null) router.refresh();
    });
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>Import</Button>

      <Dialog
        open={open}
        onClose={() => {
          setOpen(false);
          reset();
        }}
        width="lg"
        title="Import transactions"
        description="Parsed in your browser first, so you can see what was read before anything is written. Re-importing the same file is safe."
      >
        <div className="flex flex-col gap-4">
          {error !== null && <FormMessage>{error}</FormMessage>}

          {result === null ? (
            <>
              <label className="flex flex-col gap-1.5 text-[13px] font-medium text-ink-700">
                Statement file (CSV)
                <input
                  type="file"
                  accept=".csv,text/csv"
                  onChange={(event) => {
                    const file = event.currentTarget.files?.[0];
                    if (file !== undefined) void onFile(file);
                  }}
                  className="text-[13px] text-ink-600 file:mr-3 file:h-8 file:rounded-[var(--radius-sm)] file:border file:border-[var(--border-strong)] file:bg-white file:px-3 file:text-[13px] file:text-ink-700"
                />
              </label>

              {headers.length > 0 && (
                <>
                  <Preview headers={headers} rows={rows} />

                  <div className="grid gap-3 sm:grid-cols-2">
                    <ColumnPicker
                      label="Provider reference"
                      hint="What makes re-importing safe. Usually a transaction id."
                      headers={headers}
                      value={mapping.providerTransactionId}
                      onChange={(value) => setMapping({ ...mapping, providerTransactionId: value })}
                    />
                    <ColumnPicker
                      label="Merchant"
                      headers={headers}
                      value={mapping.merchantName}
                      onChange={(value) => setMapping({ ...mapping, merchantName: value })}
                    />
                    <ColumnPicker
                      label="Amount"
                      headers={headers}
                      value={mapping.amount}
                      onChange={(value) => setMapping({ ...mapping, amount: value })}
                    />
                    <ColumnPicker
                      label="Currency"
                      hint="Leave unset to use a fixed code below."
                      headers={headers}
                      value={mapping.currency}
                      onChange={(value) => setMapping({ ...mapping, currency: value })}
                    />
                    <ColumnPicker
                      label="Date"
                      headers={headers}
                      value={mapping.occurredAt}
                      onChange={(value) => setMapping({ ...mapping, occurredAt: value })}
                    />
                    <label className="flex flex-col gap-1 text-[13px] font-medium text-ink-700">
                      Currency, if not a column
                      <input
                        value={mapping.fixedCurrency}
                        onChange={(event) =>
                          setMapping({
                            ...mapping,
                            fixedCurrency: event.currentTarget.value.toUpperCase(),
                          })
                        }
                        maxLength={3}
                        placeholder="EUR"
                        className={CONTROL}
                      />
                    </label>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="flex flex-col gap-1 text-[13px] font-medium text-ink-700">
                      Entity
                      <select
                        value={entityId}
                        onChange={(event) => setEntityId(event.currentTarget.value)}
                        className={CONTROL}
                      >
                        {activeEntities.map((entity) => (
                          <option key={entity.id} value={entity.id}>
                            {entity.name}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="flex flex-col gap-1 text-[13px] font-medium text-ink-700">
                      Card, if the whole file is one card
                      <select
                        value={cardId}
                        onChange={(event) => setCardId(event.currentTarget.value)}
                        className={CONTROL}
                      >
                        <option value="">Not a card statement</option>
                        {cards.map((card) => (
                          <option key={card.id} value={card.id}>
                            {card.name}
                            {card.lastFour === null ? '' : ` ···· ${card.lastFour}`}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>

                  <label className="flex items-start gap-2 text-[13px] text-ink-700">
                    <input
                      type="checkbox"
                      checked={autoMatch}
                      onChange={(event) => setAutoMatch(event.currentTarget.checked)}
                      className="mt-0.5 size-3.5"
                    />
                    <span>
                      Try to link each charge to an approved spend request
                      <span className="block text-[12px] text-ink-500">
                        Only where the entity, the exact amount, and the timing all line up, and
                        only where one request fits. Every link is marked as automatic so you can
                        tell a guess from a decision.
                      </span>
                    </span>
                  </label>
                </>
              )}
            </>
          ) : (
            <ImportReport result={result} />
          )}

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setOpen(false);
                reset();
              }}
            >
              {result === null ? 'Cancel' : 'Close'}
            </Button>
            {result === null && (
              <Button
                variant="primary"
                loading={importing}
                disabled={rows.length === 0}
                onClick={run}
              >
                Import {rows.length > 0 ? `${String(rows.length)} rows` : ''}
              </Button>
            )}
          </div>
        </div>
      </Dialog>
    </>
  );
}

const CONTROL =
  'h-8 w-full rounded-[var(--radius-sm)] border border-[var(--border-strong)] ' +
  'bg-[var(--surface-raised)] px-2 text-[13px] text-ink-800 focus:outline-none ' +
  'focus:ring-2 focus:ring-cobalt-500/30 focus:border-cobalt-500';

interface Mapping {
  providerTransactionId: string;
  merchantName: string;
  amount: string;
  currency: string;
  occurredAt: string;
  fixedCurrency: string;
}

const EMPTY_MAPPING: Mapping = {
  providerTransactionId: '',
  merchantName: '',
  amount: '',
  currency: '',
  occurredAt: '',
  fixedCurrency: '',
};

function ColumnPicker({
  label,
  hint,
  headers,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  headers: readonly string[];
  value: string;
  onChange: (value: string) => void;
}): React.JSX.Element {
  return (
    <label className="flex flex-col gap-1 text-[13px] font-medium text-ink-700">
      {label}
      <select
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
        className={CONTROL}
      >
        <option value="">Not in this file</option>
        {headers.map((header, index) => (
          <option key={`${header}-${String(index)}`} value={String(index)}>
            {header === '' ? `Column ${String(index + 1)}` : header}
          </option>
        ))}
      </select>
      {hint !== undefined && <span className="text-[12px] font-normal text-ink-500">{hint}</span>}
    </label>
  );
}

/** The first three rows, as the parser understood them. */
function Preview({
  headers,
  rows,
}: {
  headers: readonly string[];
  rows: readonly string[][];
}): React.JSX.Element {
  return (
    <div className="overflow-x-auto rounded-[var(--radius-sm)] border border-[var(--border-subtle)]">
      <table className="w-full text-[12px]">
        <caption className="sr-only">The first rows of the file, as parsed</caption>
        <thead>
          <tr className="border-b border-[var(--border-subtle)] bg-ink-50/60 text-left text-ink-600">
            {headers.map((header, index) => (
              <th
                key={`${header}-${String(index)}`}
                scope="col"
                className="px-2 py-1.5 font-medium"
              >
                {header === '' ? `Column ${String(index + 1)}` : header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 3).map((row, rowIndex) => (
            <tr key={rowIndex} className="border-b border-[var(--border-subtle)] last:border-0">
              {headers.map((_, columnIndex) => (
                <td key={columnIndex} className="max-w-[160px] truncate px-2 py-1.5 text-ink-700">
                  {row[columnIndex] ?? ''}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="border-t border-[var(--border-subtle)] px-2 py-1.5 text-[12px] text-ink-500">
        {rows.length} {rows.length === 1 ? 'row' : 'rows'} found. The first three are shown.
      </p>
    </div>
  );
}

function ImportReport({ result }: { result: ImportResult }): React.JSX.Element {
  const problems = result.rows.filter((row) => row.outcome === 'FAILED');

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        <Badge tone="success">{result.imported} imported</Badge>
        {result.skipped > 0 && <Badge tone="neutral">{result.skipped} already present</Badge>}
        {result.matched > 0 && <Badge tone="info">{result.matched} auto-matched</Badge>}
        {result.failed > 0 && <Badge tone="danger">{result.failed} failed</Badge>}
      </div>

      {result.skipped > 0 && (
        <p className="text-[13px] text-ink-600">
          Rows already present were skipped rather than duplicated — that is what makes re-running
          an import safe.
        </p>
      )}

      {problems.length > 0 && (
        <div>
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-400">
            Rows that failed
          </div>
          <ul className="flex flex-col gap-1">
            {problems.map((row) => (
              <li
                key={`${String(row.index)}-${row.providerTransactionId}`}
                className="rounded-[var(--radius-sm)] border border-[var(--color-danger-border)] bg-[var(--color-danger-fill)] px-2.5 py-1.5 text-[13px] text-[var(--color-danger-text)]"
              >
                <span className="font-medium">Row {row.index + 2}</span>
                {row.providerTransactionId !== '' && (
                  <span className="font-mono text-[12px]"> ({row.providerTransactionId})</span>
                )}
                {' — '}
                {row.message ?? 'Could not be imported.'}
              </li>
            ))}
          </ul>
          <p className="mt-1.5 text-[12px] text-ink-500">
            Fix those lines and import the same file again. Everything that succeeded is skipped the
            second time.
          </p>
        </div>
      )}
    </div>
  );
}

// ── parsing ────────────────────────────────────────────────────────────────

/**
 * A CSV parser, deliberately small.
 *
 * It handles quoted fields, escaped quotes, and both line endings — which is
 * what a bank statement actually contains. It does not handle every dialect,
 * and the preview above is what makes that acceptable: a file it reads wrongly
 * is visibly wrong before anything is written, rather than silently wrong
 * afterwards.
 */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];

    if (quoted) {
      if (character === '"') {
        // A doubled quote inside a quoted field is one literal quote.
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += character;
      }

      continue;
    }

    if (character === '"') {
      quoted = true;
    } else if (character === ',') {
      row.push(field.trim());
      field = '';
    } else if (character === '\n' || character === '\r') {
      // `\r\n` counts once: the `\n` is consumed as the terminator and the
      // `\r` before it produced the row.
      if (character === '\r' && text[index + 1] === '\n') index += 1;

      row.push(field.trim());
      field = '';

      // Blank lines are dropped rather than becoming rows of one empty field,
      // which would otherwise be reported as failures at the end of every file.
      if (row.some((value) => value !== '')) rows.push(row);
      row = [];
    } else {
      field += character;
    }
  }

  if (field !== '' || row.length > 0) {
    row.push(field.trim());
    if (row.some((value) => value !== '')) rows.push(row);
  }

  return rows;
}

/** A first guess from the header names. Always visible, always changeable. */
function guessMapping(headers: readonly string[]): Mapping {
  const find = (...needles: string[]): string => {
    const index = headers.findIndex((header) =>
      needles.some((needle) => header.toLowerCase().includes(needle)),
    );

    return index === -1 ? '' : String(index);
  };

  return {
    providerTransactionId: find('transaction id', 'reference', 'id'),
    merchantName: find('merchant', 'description', 'payee', 'narrative'),
    amount: find('amount', 'value', 'debit'),
    currency: find('currency', 'ccy'),
    occurredAt: find('date', 'when', 'posted'),
    fixedCurrency: '',
  };
}

function validate(mapping: Mapping, entityId: string): string | null {
  if (entityId === '') return 'Choose which entity this spend belongs to.';
  if (mapping.providerTransactionId === '') {
    return 'Choose the column holding each row’s reference. Without one, re-importing the file would duplicate everything.';
  }
  if (mapping.merchantName === '') return 'Choose the column holding the merchant.';
  if (mapping.amount === '') return 'Choose the column holding the amount.';
  if (mapping.occurredAt === '') return 'Choose the column holding the date.';
  if (mapping.currency === '' && mapping.fixedCurrency.length !== 3) {
    return 'Either choose a currency column, or type the three-letter code the whole file is in.';
  }

  return null;
}

/**
 * One parsed row, or `null` if it cannot be read.
 *
 * Unreadable rows are dropped here rather than sent for the server to reject:
 * a row with an unparseable date is a local problem with a local fix, and
 * posting it would spend a round trip to be told something the browser already
 * knew.
 */
function toRow(
  row: readonly string[],
  mapping: Mapping,
  entityId: string,
  cardId: string,
): {
  providerTransactionId: string;
  entityId: string;
  cardId?: string;
  merchantName: string;
  amount: { amount: string; currency: string };
  occurredAt: string;
  status: 'POSTED';
} | null {
  const at = (index: string): string => (index === '' ? '' : (row[Number(index)] ?? ''));

  const reference = at(mapping.providerTransactionId);
  const merchant = at(mapping.merchantName);
  const rawAmount = at(mapping.amount);
  const currency = (mapping.currency === '' ? mapping.fixedCurrency : at(mapping.currency))
    .trim()
    .toUpperCase();

  const occurred = parseDate(at(mapping.occurredAt));

  if (reference === '' || merchant === '' || rawAmount === '' || occurred === null) return null;
  if (currency.length !== 3) return null;

  // A statement writes 1.234,56 as often as 1,234.56, and a debit as
  // "-45.00" or "(45.00)". Normalised to an unsigned decimal string, because
  // the sign is carried by the transaction's type rather than its amount.
  const amount = normaliseAmount(rawAmount);

  if (amount === null) return null;

  return {
    providerTransactionId: reference,
    entityId,
    ...(cardId === '' ? {} : { cardId }),
    merchantName: merchant,
    amount: { amount, currency },
    occurredAt: occurred,
    status: 'POSTED',
  };
}

function normaliseAmount(raw: string): string | null {
  const cleaned = raw.replace(/[()\s]/g, '').replace(/^[-+]/, '');

  // Whichever separator comes last is the decimal point. That is true of every
  // European and Anglo format and is the only rule that gets both right
  // without asking.
  const lastComma = cleaned.lastIndexOf(',');
  const lastDot = cleaned.lastIndexOf('.');

  let normalised: string;

  if (lastComma > lastDot) {
    normalised = cleaned.replace(/\./g, '').replace(',', '.');
  } else {
    normalised = cleaned.replace(/,/g, '');
  }

  // Strip anything that is not a digit or the decimal point — currency symbols
  // travel in these columns more often than not.
  normalised = normalised.replace(/[^\d.]/g, '');

  if (normalised === '' || Number.isNaN(Number(normalised))) return null;

  return Number(normalised).toFixed(2);
}

/**
 * A date, as an instant at UTC midnight.
 *
 * `DD/MM/YYYY` is read as day-first, because this product's audience writes it
 * that way and `Date.parse` reads it as month-first — which silently turns the
 * 3rd of April into the 4th of March for eleven days a month.
 */
function parseDate(raw: string): string | null {
  const value = raw.trim();
  if (value === '') return null;

  const slash = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(value);

  if (slash !== null) {
    const [, day, month, year] = slash;
    return `${year ?? ''}-${(month ?? '').padStart(2, '0')}-${(day ?? '').padStart(2, '0')}T00:00:00.000Z`;
  }

  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (iso !== null) return `${iso[1] ?? ''}-${iso[2] ?? ''}-${iso[3] ?? ''}T00:00:00.000Z`;

  const parsed = new Date(value);

  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

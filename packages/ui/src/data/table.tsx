import * as React from 'react';
import { cn } from '../lib/cn';

/**
 * Data table.
 *
 * The most important component in the product: a finance user spends most of
 * their day in one, and the thing they are doing is *scanning* — looking down
 * a column for the row that is wrong. Every decision here serves that
 * (docs/UI-DESIGN-SYSTEM.md §6.3):
 *
 *  - **32px rows (28px compact).** They were 44 and 36. A reconciliation queue
 *    is read by comparing rows to each other, and rows you have to scroll
 *    between cannot be compared — the taller row was costing a third of the
 *    screen to whitespace inside cells that hold a date and a number.
 *  - **13px text with tabular figures.** One step down from the body scale,
 *    because a table is reference material rather than prose, and tabular
 *    digits are what make a column of amounts line up on the decimal point.
 *  - **A sticky header.** The specification asked for one and the component
 *    never had it, so the column you were reading stopped being labelled at
 *    row 20. That is the single most useful pixel in a long table.
 *  - **Hairline separators, no zebra striping.** Stripes add noise at this
 *    density without aiding scanning; at 32px the rule is enough.
 *  - Wide content scrolls inside its own container; the page body never
 *    scrolls horizontally.
 */

export interface Column<T> {
  key: string;
  header: React.ReactNode;
  /** `numeric` right-aligns and applies tabular figures. */
  align?: 'left' | 'right';
  width?: string;
  render: (row: T) => React.ReactNode;
}

export interface DataTableProps<T> {
  columns: ReadonlyArray<Column<T>>;
  rows: readonly T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  density?: 'default' | 'compact';
  /** Rendered in place of the body when `rows` is empty. */
  emptyState?: React.ReactNode;
  caption?: string;
  className?: string;
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
  density = 'default',
  emptyState,
  caption,
  className,
}: DataTableProps<T>): React.JSX.Element {
  const rowHeight = density === 'compact' ? 'h-7' : 'h-8';
  const cellPadding = density === 'compact' ? 'px-2.5' : 'px-3';

  if (rows.length === 0 && emptyState) {
    return <div className={className}>{emptyState}</div>;
  }

  return (
    <div className={cn('w-full overflow-x-auto', className)}>
      <table className="w-full border-collapse text-[13px]">
        {caption && <caption className="sr-only">{caption}</caption>}
        {/*
          `sticky` on the cells rather than the row: a `<tr>` is not a
          positioning context in every engine, and sticking the row leaves the
          borders behind while the text travels.
        */}
        <thead className="sticky top-0 z-10">
          <tr className="bg-[var(--surface-sunken)]">
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                style={column.width ? { width: column.width } : undefined}
                className={cn(
                  'sticky top-0 h-8 bg-[var(--surface-sunken)]',
                  'text-[10.5px] font-semibold tracking-[0.06em] whitespace-nowrap text-ink-500 uppercase',
                  // A border on a sticky cell scrolls away with the box model,
                  // so the rule under the header is drawn as a shadow instead.
                  'shadow-[inset_0_-1px_0_var(--border-default)]',
                  cellPadding,
                  column.align === 'right' ? 'text-right' : 'text-left',
                )}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--border-subtle)]">
          {rows.map((row) => (
            <tr
              key={rowKey(row)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              onKeyDown={
                onRowClick
                  ? (event) => {
                      if (event.key === 'Enter') onRowClick(row);
                    }
                  : undefined
              }
              // A clickable row must be reachable and activatable by keyboard,
              // or the whole table is unusable without a mouse (NFR-UX-002).
              tabIndex={onRowClick ? 0 : undefined}
              className={cn(
                rowHeight,
                'transition-colors duration-100 hover:bg-[var(--surface-sunken)]',
                onRowClick &&
                  'cursor-pointer focus-visible:bg-[var(--surface-sunken)] focus-visible:outline-none',
              )}
            >
              {columns.map((column) => (
                <td
                  key={column.key}
                  className={cn(
                    'text-ink-700',
                    cellPadding,
                    // `tabular-nums` on every cell, not only the right-aligned
                    // ones: a date column and an id column are read by
                    // comparing them down the page too, and proportional
                    // digits make the same date in two rows different widths.
                    'tabular-nums',
                    column.align === 'right' ? 'text-right' : 'text-left',
                  )}
                >
                  {column.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

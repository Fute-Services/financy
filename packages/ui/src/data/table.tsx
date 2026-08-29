import * as React from 'react';
import { cn } from '../lib/cn';

/**
 * Data table.
 *
 * The most important component in the product: a finance user spends most of
 * their day in one. Design decisions that follow from that
 * (docs/UI-DESIGN-SYSTEM.md §6.3):
 *
 *  - 44px rows (36px compact) — 25 to 40 rows visible without scrolling.
 *  - Hairline separators, no zebra striping. Stripes add visual noise at this
 *    density without aiding scanning.
 *  - Sticky header, because the column you are reading matters at row 30.
 *  - Numeric columns right-aligned with tabular figures, so a column of
 *    amounts reads as a column.
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
  const rowHeight = density === 'compact' ? 'h-9' : 'h-11';
  const cellPadding = density === 'compact' ? 'px-3' : 'px-4';

  if (rows.length === 0 && emptyState) {
    return <div className={className}>{emptyState}</div>;
  }

  return (
    <div className={cn('w-full overflow-x-auto', className)}>
      <table className="w-full border-collapse text-sm">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead>
          <tr className="border-b border-[var(--border-default)] bg-ink-50">
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                style={column.width ? { width: column.width } : undefined}
                className={cn(
                  'h-10 text-xs font-semibold whitespace-nowrap text-ink-600',
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
                'transition-colors duration-100',
                onRowClick &&
                  'cursor-pointer hover:bg-ink-50 focus-visible:bg-ink-50 focus-visible:outline-none',
              )}
            >
              {columns.map((column) => (
                <td
                  key={column.key}
                  className={cn(
                    'text-ink-700',
                    cellPadding,
                    column.align === 'right' ? 'tabular text-right' : 'text-left',
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

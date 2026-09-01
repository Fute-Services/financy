'use client';

import * as React from 'react';
import { cn } from '../lib/cn';

/**
 * A modal dialog, on the native `<dialog>` element.
 *
 * Native rather than a div with a z-index, and the difference is not cosmetic:
 * the browser gives focus trapping, `Escape` to close, inertness of the page
 * behind, and top-layer stacking that no `z-index` can lose a fight with. A
 * hand-rolled modal reimplements all four, and the accessibility ones are the
 * ones it gets wrong.
 *
 * **Closing is never silent.** `onClose` fires for the backdrop, the button,
 * and `Escape` alike, so a form that wants to warn about unsaved work has one
 * place to do it rather than three.
 */

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  /** One sentence under the title. Say what the action does, not that it is a form. */
  description?: string | undefined;
  children: React.ReactNode;
  footer?: React.ReactNode;
  width?: 'sm' | 'md' | 'lg';
}

const WIDTHS = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl' } as const;

export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  width = 'md',
}: DialogProps): React.JSX.Element {
  const ref = React.useRef<HTMLDialogElement>(null);

  React.useEffect(() => {
    const element = ref.current;
    if (element === null) return;

    // `showModal()` rather than the `open` attribute. Only the former puts the
    // dialog in the top layer and makes the rest of the page inert; setting
    // `open` renders a dialog that looks modal and is not.
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby="dialog-title"
      onCancel={(event) => {
        // `Escape` closes natively; intercepting it keeps React state and the
        // DOM in agreement, which they otherwise stop being on the first press.
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        // A click on the backdrop lands on the dialog element itself; one on
        // the content lands on a child. Comparing targets is what tells them
        // apart without a wrapper div that would break the top layer.
        if (event.target === ref.current) onClose();
      }}
      className={cn(
        'w-[calc(100vw-2rem)] rounded-xl border border-[var(--border-strong)] bg-[var(--surface-raised)] p-0',
        'text-ink-800 shadow-xl backdrop:bg-ink-900/40 backdrop:backdrop-blur-[1px]',
        WIDTHS[width],
      )}
    >
      <div className="flex items-start justify-between gap-4 border-b border-[var(--border-subtle)] px-5 py-4">
        <div>
          <h2 id="dialog-title" className="text-[15px] font-semibold text-ink-900">
            {title}
          </h2>
          {description !== undefined ? (
            <p className="mt-1 text-[13px] text-ink-600">{description}</p>
          ) : null}
        </div>

        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="-mr-1 -mt-1 rounded-md p-1.5 text-ink-500 hover:bg-ink-50 hover:text-ink-700"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path
              d="M4 4l8 8M12 4l-8 8"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>

      <div className="px-5 py-4">{children}</div>

      {footer !== undefined ? (
        <div className="flex items-center justify-end gap-2 border-t border-[var(--border-subtle)] bg-ink-50/50 px-5 py-3">
          {footer}
        </div>
      ) : null}
    </dialog>
  );
}

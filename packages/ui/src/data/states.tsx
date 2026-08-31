import * as React from 'react';
import { cn } from '../lib/cn';
import { Button } from '../primitives/button';

/**
 * The four states every screen must implement, plus the three distinct kinds
 * of empty (docs/04-INFORMATION-ARCHITECTURE.md §4.6-4.9).
 *
 * They live in the design system rather than being written per screen so that
 * "no records exist yet", "your filters excluded everything", and "nothing is
 * assigned to you" cannot be conflated — they mean different things and the
 * user's next action differs in each case.
 */

// ── Empty ────────────────────────────────────────────────────────────────

interface EmptyShellProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  action?: React.ReactNode;
  className?: string;
}

function EmptyShell({
  icon,
  title,
  description,
  action,
  className,
}: EmptyShellProps): React.JSX.Element {
  return (
    <div
      className={cn('flex flex-col items-center justify-center px-6 py-16 text-center', className)}
    >
      <div className="mb-4 text-ink-300">{icon}</div>
      <h3 className="text-base font-semibold text-ink-800">{title}</h3>
      <p className="mt-1.5 max-w-md text-sm text-ink-500">{description}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

/** No records exist at all. Explain the module's purpose and offer the way in. */
export function FirstRunEmptyState(props: {
  title: string;
  description: string;
  action?: React.ReactNode;
}): React.JSX.Element {
  return <EmptyShell icon={<BoxIcon className="size-12" />} {...props} />;
}

/** Records exist; the current filters exclude all of them. */
export function FilteredEmptyState({ onClear }: { onClear?: () => void }): React.JSX.Element {
  return (
    <EmptyShell
      icon={<FilterIcon className="size-8" />}
      title="No results match these filters"
      description="Try widening the date range or removing a filter."
      action={
        onClear ? (
          <Button variant="secondary" size="sm" onClick={onClear}>
            Clear filters
          </Button>
        ) : undefined
      }
    />
  );
}

/**
 * Records exist, but none are in the viewer's scope.
 *
 * Deliberately offers no call to action — suggesting one would imply their
 * access is broken when it is working exactly as configured.
 */
export function ScopeEmptyState({
  title = 'Nothing assigned to you',
  description = 'When something needs your attention, it will appear here.',
}: {
  title?: string;
  description?: string;
}): React.JSX.Element {
  return (
    <EmptyShell icon={<InboxIcon className="size-8" />} title={title} description={description} />
  );
}

// ── Loading ──────────────────────────────────────────────────────────────

/**
 * Skeletons match the final layout's geometry. A centred spinner tells the
 * user nothing about what is arriving, and causes a layout jump when it does.
 */
export function Skeleton({ className }: { className?: string }): React.JSX.Element {
  return (
    <div
      className={cn('animate-pulse rounded-[var(--radius-sm)] bg-ink-100', className)}
      aria-hidden="true"
    />
  );
}

export function TableSkeleton({
  rows = 8,
  columns = 6,
}: {
  rows?: number;
  columns?: number;
}): React.JSX.Element {
  return (
    <div role="status" aria-label="Loading" className="divide-y divide-[var(--border-subtle)]">
      {Array.from({ length: rows }, (_, rowIndex) => (
        <div key={rowIndex} className="flex h-11 items-center gap-4 px-4">
          {Array.from({ length: columns }, (_, columnIndex) => (
            <Skeleton
              key={columnIndex}
              className={cn('h-3.5', columnIndex === 0 ? 'w-40' : 'flex-1')}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

// ── Error ────────────────────────────────────────────────────────────────

/**
 * The error code and correlation id are shown deliberately: a user who can
 * quote them turns an unreproducible support ticket into a one-query
 * investigation (NFR-OBS-002).
 */
export function ErrorState({
  title = 'Something went wrong',
  message,
  code,
  correlationId,
  onRetry,
}: {
  title?: string;
  message: string;
  code?: string;
  correlationId?: string;
  onRetry?: () => void;
}): React.JSX.Element {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
      <div className="mb-4 text-[var(--color-danger-text)]">
        <AlertIcon className="size-8" />
      </div>
      <h3 className="text-base font-semibold text-ink-800">{title}</h3>
      <p className="mt-1.5 max-w-md text-sm text-ink-500">{message}</p>
      {(code ?? correlationId) && (
        <p className="mt-3 font-mono text-xs text-ink-400">
          {code}
          {code && correlationId && ' · '}
          {correlationId}
        </p>
      )}
      {onRetry && (
        <Button variant="secondary" size="sm" className="mt-5" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

// ── Permission ───────────────────────────────────────────────────────────

/**
 * Not a redirect and not a 404.
 *
 * Naming the required permission turns "it's broken" into a specific,
 * actionable request the user can make of their administrator.
 */
export function PermissionState({
  permission,
  onBack,
}: {
  permission?: string;
  onBack?: () => void;
}): React.JSX.Element {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
      <div className="mb-4 text-ink-400">
        <LockIcon className="size-8" />
      </div>
      <h3 className="text-base font-semibold text-ink-800">You don&rsquo;t have access to this</h3>
      <p className="mt-1.5 max-w-md text-sm text-ink-500">
        {permission ? (
          <>
            This page requires the <code className="font-mono text-ink-600">{permission}</code>{' '}
            permission. Ask an organisation admin if you need it.
          </>
        ) : (
          'Ask an organisation admin if you need access.'
        )}
      </p>
      {onBack && (
        <Button variant="secondary" size="sm" className="mt-5" onClick={onBack}>
          Go back
        </Button>
      )}
    </div>
  );
}

// ── Icons ────────────────────────────────────────────────────────────────
// Line icons, 1.5px stroke, currentColor, on a 24px grid.

function BoxIcon({ className }: { className?: string }): React.JSX.Element {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M21 8v8a2 2 0 0 1-1 1.73l-7 4a2 2 0 0 1-2 0l-7-4A2 2 0 0 1 3 16V8a2 2 0 0 1 1-1.73l7-4a2 2 0 0 1 2 0l7 4A2 2 0 0 1 21 8Z M3.3 7 12 12l8.7-5 M12 22V12"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function FilterIcon({ className }: { className?: string }): React.JSX.Element {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M3 5h18l-7 8v6l-4 2v-8L3 5Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function InboxIcon({ className }: { className?: string }): React.JSX.Element {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M3 13h5l1.5 3h5L16 13h5 M5 5h14l2 8v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4l2-8Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function AlertIcon({ className }: { className?: string }): React.JSX.Element {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 9v4m0 4h.01M10.3 3.9 2 18a2 2 0 0 0 1.7 3h16.6a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function LockIcon({ className }: { className?: string }): React.JSX.Element {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M7 11V7a5 5 0 0 1 10 0v4 M5 11h14v10H5V11Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * The honesty banner.
 *
 * Any screen showing invented figures must render this. It is not a nicety:
 * a finance interface that displays plausible numbers without saying where
 * they came from is the exact failure mode docs/01 §7 principle 9 and
 * ADR-0014 exist to prevent. A viewer must never have to guess whether a
 * number on this screen is real.
 *
 * It is removed together with `lib/preview-data.ts` when the API lands.
 */
export function PreviewBanner({ endpoint }: { endpoint: string }): React.JSX.Element {
  return (
    <div className="mb-6 flex items-start gap-3 rounded-[var(--radius-md)] border border-[var(--color-warning-border)] bg-[var(--color-warning-fill)] px-4 py-3">
      <svg
        className="mt-0.5 size-4 shrink-0 text-[var(--color-warning-text)]"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        aria-hidden="true"
      >
        <path d="M12 9v4m0 4h.01M10.3 3.9 2 18a2 2 0 0 0 1.7 3h16.6a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
      </svg>
      <div className="text-sm">
        <p className="font-medium text-[var(--color-warning-text)]">
          Preview data — no figure on this screen is real
        </p>
        <p className="mt-0.5 text-[var(--color-warning-text)]/85">
          The API is not built yet. Every amount, count, and status here is invented so the
          interface can be reviewed. Real values arrive from{' '}
          <code className="font-mono text-[13px]">{endpoint}</code>, computed server-side.
        </p>
      </div>
    </div>
  );
}

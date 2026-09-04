import { Badge } from '@financy/ui';

/**
 * Standard page header: title, optional count, description, primary action.
 *
 * Consistent placement matters more than it looks — a finance user moving
 * between twelve modules should never have to hunt for the primary action.
 */
export function PageHeader({
  title,
  description,
  count,
  phase,
  action,
}: {
  // Written `?: T | undefined` rather than `?: T` because the repository runs
  // with `exactOptionalPropertyTypes`. Without the explicit `undefined`, a
  // caller cannot pass a value that may legitimately be absent — which is the
  // common case when the text comes from a nullable API field.
  title: string;
  description?: string | undefined;
  count?: string | undefined;
  /** Roadmap phase that delivers this module, shown while it is unbuilt. */
  phase?: number | undefined;
  action?: React.ReactNode | undefined;
}): React.JSX.Element {
  return (
    /*
      A console header, not a marketing one. `text-2xl` — 24px — was set for a
      page you land on and read; this is a page you pass through forty times a
      day on the way to a table, and every pixel it takes is a row the table
      does not get. 17px still reads as the title of the screen because nothing
      else on it competes.
    */
    <div className="mb-4 flex items-start justify-between gap-6">
      <div className="min-w-0">
        <div className="flex items-baseline gap-2.5">
          <h1 className="text-[17px] leading-6 font-semibold tracking-[-0.015em] text-ink-900">
            {title}
          </h1>
          {count && <span className="text-[12.5px] text-ink-500 tabular-nums">{count}</span>}
          {phase !== undefined && (
            <Badge tone="info" title={`Delivered in Phase ${phase} of the roadmap`}>
              Phase {phase}
            </Badge>
          )}
        </div>
        {description && (
          <p className="mt-1 max-w-3xl text-[12.5px] leading-[1.5] text-ink-500">{description}</p>
        )}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

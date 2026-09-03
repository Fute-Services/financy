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
    <div className="mb-6 flex items-start justify-between gap-6">
      <div className="min-w-0">
        <div className="flex items-center gap-2.5">
          <h1 className="text-2xl font-semibold tracking-tight text-ink-900">{title}</h1>
          {count && <span className="tabular text-sm text-ink-500">{count}</span>}
          {phase !== undefined && (
            <Badge tone="info" title={`Delivered in Phase ${phase} of the roadmap`}>
              Phase {phase}
            </Badge>
          )}
        </div>
        {description && <p className="mt-1.5 max-w-2xl text-sm text-ink-500">{description}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

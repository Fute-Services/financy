import type { CardLimitHistory } from '@financy/contracts';
import { LIMIT_PERIOD_LABELS } from '@financy/contracts';
import { Badge, Card, CardBody, CardHeader, Money } from '@financy/ui';

/**
 * Every limit this card has ever had.
 *
 * The reason this table is append-only rather than a column somebody updates.
 * "Who raised this card to 50,000 and why?" is a question an auditor asks, and
 * an `UPDATE` throws away the only evidence that could answer it. The newest
 * row is the current limit; the ones below it are what it used to be.
 */
export function LimitHistory({
  history,
}: {
  history: readonly CardLimitHistory[];
}): React.JSX.Element {
  return (
    <Card className="self-start">
      <CardHeader
        title="Limit history"
        description="Append-only. Nothing here is ever edited or removed."
      />

      <CardBody className="p-0">
        {history.length === 0 ? (
          <p className="px-5 py-6 text-[13px] text-ink-500">No changes recorded.</p>
        ) : (
          <ol className="divide-y divide-[var(--border-subtle)]">
            {history.map((entry, index) => (
              <li key={entry.id} className="px-5 py-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-sm font-semibold text-ink-900">
                    <Money amount={entry.amount} currency={entry.currency} />
                    <span className="ml-1 text-[12px] font-normal text-ink-500">
                      {LIMIT_PERIOD_LABELS[entry.period]}
                    </span>
                  </span>
                  {index === 0 && (
                    <Badge tone="success" dot>
                      Current
                    </Badge>
                  )}
                </div>

                {entry.reason !== null && entry.reason !== '' && (
                  <p className="mt-1 text-[13px] text-ink-700">{entry.reason}</p>
                )}

                <p className="mt-0.5 text-[12px] text-ink-400">
                  {entry.setBy ?? 'Unknown'} ·{' '}
                  <time dateTime={entry.effectiveFrom}>{formatDate(entry.effectiveFrom)}</time>
                </p>
              </li>
            ))}
          </ol>
        )}
      </CardBody>
    </Card>
  );
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

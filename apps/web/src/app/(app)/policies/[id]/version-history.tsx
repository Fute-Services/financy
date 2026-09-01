import { Badge, Card, CardBody, CardHeader } from '@financy/ui';
import type { PolicyVersionSummary } from '@financy/contracts';

/**
 * Every version this policy has had.
 *
 * It is here for one question: **"what were the rules when this decision was
 * made?"** A stored decision names the policy version it was evaluated under,
 * and without a visible history that id is an opaque string. With one, it is a
 * date, an author, and a sentence saying what changed.
 *
 * The open draft appears at the top and is marked as deciding nothing, because
 * the alternative — hiding it until published — makes the list disagree with
 * the editor directly above it.
 */
export function VersionHistory({
  versions,
  currentVersion,
}: {
  versions: readonly PolicyVersionSummary[];
  currentVersion: number | null;
}): React.JSX.Element {
  return (
    <Card>
      <CardHeader
        title="History"
        description="Published versions are frozen. A decision made under one stays explicable by it."
      />

      <CardBody className="p-0">
        {versions.length === 0 ? (
          <p className="px-5 py-6 text-sm text-ink-500">No versions yet.</p>
        ) : (
          <ol className="divide-y divide-[var(--border-subtle)]">
            {versions.map((version) => (
              <li key={version.id} className="flex items-start gap-3 px-5 py-3">
                <span className="tabular mt-0.5 w-8 shrink-0 text-[13px] font-medium text-ink-500">
                  v{version.version}
                </span>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    {version.publishedAt === null ? (
                      <Badge tone="info">Draft — deciding nothing</Badge>
                    ) : version.version === currentVersion ? (
                      <Badge tone="success" dot>
                        Live
                      </Badge>
                    ) : (
                      <Badge tone="neutral">Superseded</Badge>
                    )}

                    <span className="text-[13px] text-ink-600">
                      {version.ruleCount} {version.ruleCount === 1 ? 'rule' : 'rules'}
                    </span>
                  </div>

                  {version.note !== null && version.note !== '' && (
                    <p className="mt-1 text-[13px] leading-relaxed text-ink-700">{version.note}</p>
                  )}

                  <p className="mt-1 text-[12px] text-ink-400">
                    {version.createdBy ?? 'Unknown'} ·{' '}
                    <time dateTime={version.publishedAt ?? version.createdAt}>
                      {formatDate(version.publishedAt ?? version.createdAt)}
                    </time>
                  </p>
                </div>
              </li>
            ))}
          </ol>
        )}
      </CardBody>
    </Card>
  );
}

/**
 * Rendered on the server, in a fixed locale.
 *
 * `toLocaleDateString` with the browser's locale would produce a different
 * string in the client render than in the server one and hydrate with a
 * mismatch — a class of bug that shows up as a console warning and a flash of
 * the wrong date.
 */
function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

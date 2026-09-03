import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Card, CardBody, PermissionState, Badge } from '@financy/ui';
import { PageHeader } from '@/components/page-header';
import { NAV_ITEMS } from '@/lib/navigation';
import { can, getSession } from '@/lib/session';

/**
 * Catch-all for modules that are on the roadmap but not yet built.
 *
 * Three distinct outcomes, and the distinction matters:
 *
 *  - **Not a known route** → 404.
 *  - **Known route, permission absent** → the permission state, naming the
 *    permission required. Not a redirect and not a 404: hiding a feature the
 *    user could legitimately request access to is unhelpful, and a redirect
 *    leaves them wondering whether they clicked the wrong thing
 *    (docs/04-INFORMATION-ARCHITECTURE.md §4.9).
 *  - **Known route, permitted, not yet built** → an honest statement of which
 *    phase delivers it and what it will contain.
 *
 * A page that renders a plausible-looking but non-functional screen would be
 * worse than any of these — docs/19 §5 names it as an anti-pattern, because it
 * teaches users to trust something that does not exist.
 */

interface Props {
  params: Promise<{ slug: string[] }>;
}

const PHASE_CONTENT: Record<number, string[]> = {
  1: [
    'Authentication, sessions, and session revocation',
    'Organisation, entities, and the department tree',
    'Memberships, invitations, roles, and RBAC guards',
    'The immutable audit log',
  ],
  2: [
    'The data-driven policy engine, versioned and simulatable',
    'Approval workflows, steps, delegation, and escalation',
    'Spend requests with a dry-run policy preview',
    'Card abstraction and the transaction model',
  ],
  3: [
    'Receipt upload to private storage via signed URLs',
    'Expenses, itemisation, and submission',
    'Reimbursement batches, with duplicate payment made impossible',
    'The finance review queue',
  ],
  4: [
    'Budgets with an append-only movement ledger',
    'Allocated, committed, actual, and remaining — computed under a row lock',
    'The dashboard and twelve reports',
    'CSV export, filtered, scoped, and audited',
  ],
  5: [
    'Vendor master with duplicate detection',
    'Bills and accounts payable, through the existing approval engine',
    'Purchase orders and three-way match',
  ],
  6: [
    'Chart of accounts, cost centres, and tax codes',
    'Mapping rules and idempotent accounting export',
    'Row-level security, MFA enrolment, and pilot hardening',
  ],
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const item = findNavItem(slug);
  return { title: item?.label ?? 'Not found' };
}

export default async function ModulePage({ params }: Props): Promise<React.JSX.Element> {
  const { slug } = await params;

  const item = findNavItem(slug);
  if (!item) notFound();

  const session = await getSession();

  // The layout redirects when there is no session, so this is defensive only.
  if (session !== null && item.permission !== null && !can(session, item.permission)) {
    return (
      <>
        <PageHeader title={item.label} />
        <Card>
          <PermissionState permission={item.permission} />
        </Card>
      </>
    );
  }

  const contents = PHASE_CONTENT[item.phase] ?? [];

  return (
    <>
      <PageHeader
        title={item.label}
        description={`Designed in full. Delivered in Phase ${item.phase} of the roadmap.`}
        phase={item.phase}
      />

      <Card>
        <CardBody className="py-12">
          <div className="mx-auto max-w-xl text-center">
            <h2 className="text-base font-semibold text-ink-800">
              This module isn&rsquo;t built yet
            </h2>
            <p className="mt-2 text-sm text-ink-500">
              The schema, API contract, permissions, workflows, and screens for {item.label} are
              specified in <code className="font-mono text-[13px] text-ink-600">docs/</code>. The
              build order is dependency order, not demo order — identity and audit come first, so
              that everything above them can be trusted.
            </p>

            {contents.length > 0 && (
              <div className="mt-7 text-left">
                <Badge tone="info" dot>
                  Phase {item.phase} delivers
                </Badge>
                <ul className="mt-3 space-y-1.5">
                  {contents.map((entry) => (
                    <li key={entry} className="flex gap-2.5 text-sm text-ink-600">
                      <span
                        className="mt-2 size-1 shrink-0 rounded-full bg-ink-300"
                        aria-hidden="true"
                      />
                      {entry}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <p className="mt-7 text-xs text-ink-400">
              Requires{' '}
              <code className="font-mono">{item.permission ?? 'any active membership'}</code>
            </p>
          </div>
        </CardBody>
      </Card>
    </>
  );
}

function findNavItem(slug: string[]): (typeof NAV_ITEMS)[number] | undefined {
  const path = `/${slug.join('/')}`;
  return (
    NAV_ITEMS.find((item) => item.href === path) ??
    NAV_ITEMS.find((item) => path.startsWith(`${item.href}/`)) ??
    // `/settings` resolves to the organisation settings page.
    (path === '/settings'
      ? NAV_ITEMS.find((item) => item.href === '/settings/organization')
      : undefined)
  );
}

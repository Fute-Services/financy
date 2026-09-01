import type { Metadata } from 'next';
import Link from 'next/link';
import type { Delegation, QueueItem, Resource } from '@financy/contracts';
import { Card, CardBody, CardHeader, PermissionState, ScopeEmptyState } from '@financy/ui';

import { PageHeader } from '@/components/page-header';
import { apiFetch } from '@/lib/api';
import { can, getSession } from '@/lib/session';
import { QueueRow } from './queue-row';
import { DelegationPanel } from './delegation-panel';

export const metadata: Metadata = { title: 'Approvals' };

/**
 * What is waiting on the caller.
 *
 * ## Everything needed to decide is on the row
 *
 * Amount, purpose, who asked, how long it has been waiting. An approver who has
 * to open every request to learn what it is spends four clicks per decision,
 * and a queue that costs four clicks per decision is a queue that gets left to
 * pile up — at which point the control the whole product exists to provide is
 * not being applied.
 *
 * ## The queue holds only steps this person can act on
 *
 * Not "steps naming them": a `PARALLEL_ALL` step somebody has already approved
 * still names them, and leaving it here would mean a queue that never empties.
 * The API filters both — active steps only, and none they have already acted
 * on.
 *
 * ## Empty is a good state, and reads like one
 *
 * `ScopeEmptyState` deliberately offers no call to action. An empty approval
 * queue means the person is finished, and suggesting they do something would
 * imply otherwise.
 */
export default async function ApprovalsPage(): Promise<React.JSX.Element> {
  const session = await getSession();

  if (session === null || !can(session, 'approval:read')) {
    return (
      <>
        <PageHeader title="Approvals" />
        <Card>
          <PermissionState permission="approval:read" />
        </Card>
      </>
    );
  }

  const canAct = can(session, 'approval:act');
  const canOverride = can(session, 'approval:override');
  const canDelegate = can(session, 'approval:delegate');

  const [queue, delegations] = await Promise.all([
    apiFetch<Resource<QueueItem[]>>('/approvals/queue'),
    canDelegate
      ? apiFetch<Resource<Delegation[]>>('/approvals/delegations?scope=mine').catch(() => ({
          data: [] as Delegation[],
        }))
      : Promise.resolve({ data: [] as Delegation[] }),
  ]);

  const items = queue.data;

  /**
   * There is deliberately no "total waiting" figure here.
   *
   * The rows can be in different currencies, and adding across them in the
   * browser would produce a number that is confidently wrong — which is the
   * class of thing docs/19 forbids outright: no financial figure is computed
   * client-side. When a currency-aware total is worth having, it comes from
   * the server with the queue.
   */
  const oldest = items[0];

  return (
    <>
      <PageHeader
        title="Approvals"
        description="Steps waiting on you. Each one is somebody unable to spend until you decide."
        count={`${String(items.length)} waiting`}
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-4">
          <Card>
            <CardHeader
              title="Your queue"
              description={
                oldest === undefined || oldest.activatedAt === null
                  ? undefined
                  : // How long the *oldest* has waited, rather than an average.
                    // An average hides the one that has been sitting for nine
                    // days, and that one is the whole reason to look.
                    `Oldest has been waiting since ${formatDate(oldest.activatedAt)}.`
              }
            />
            <CardBody className="p-0">
              {items.length === 0 ? (
                <ScopeEmptyState
                  title="Nothing waiting on you"
                  description="When a request needs your decision, it appears here — with enough on the row to decide without opening it."
                />
              ) : (
                <ul className="divide-y divide-[var(--border-subtle)]">
                  {items.map((item) => (
                    <QueueRow
                      key={item.stepId}
                      item={item}
                      canAct={canAct}
                      canOverride={canOverride}
                    />
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>

          {!canAct && (
            <p className="text-[13px] text-ink-500">
              You can see approvals but not act on them. Approving spend belongs to finance and
              managers — administering people and structure is a separate authority on purpose.
            </p>
          )}
        </div>

        <div className="flex flex-col gap-4">
          {canDelegate && (
            <DelegationPanel
              delegations={delegations.data}
              myMembershipId={session.membership.id}
            />
          )}

          <Card>
            <CardHeader title="How a chain moves" />
            <CardBody className="flex flex-col gap-2.5 text-[13px] leading-relaxed text-ink-600">
              <p>
                Steps run in order; approvers within a step are asked at the same time. Only one
                step is open at a time, which is what makes &ldquo;the manager, then finance&rdquo;
                mean what it says.
              </p>
              <p>
                <strong className="font-medium text-ink-800">A rejection ends everything</strong>{' '}
                immediately — later steps are not asked. Continuing to collect approvals on a
                refused request would produce a record in which somebody approved what had already
                been rejected.
              </p>
              <p>
                <strong className="font-medium text-ink-800">Returning is not rejecting.</strong> It
                hands the request back to be fixed, and resubmitting evaluates policy from scratch —
                so the new chain may not be the one you are looking at.
              </p>
              <p>
                You can never approve your own request, including through a delegation that hands
                the authority back to you.
              </p>
            </CardBody>
          </Card>

          <p className="text-[12px] text-ink-400">
            Looking for something already decided? Open it from{' '}
            <Link href="/spend" className="text-cobalt-500 hover:underline">
              spend requests
            </Link>{' '}
            — its full timeline is on the request.
          </p>
        </div>
      </div>
    </>
  );
}

/** Fixed locale, so the server and client renders produce the same string. */
function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

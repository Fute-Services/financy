import type { Metadata } from 'next';
import type { OffsetCollection, TransactionRecord } from '@financy/contracts';
import { Card, PermissionState, ScopeEmptyState } from '@financy/ui';

import { PageHeader } from '@/components/page-header';
import { apiFetch } from '@/lib/api';
import { can, getSession } from '@/lib/session';
import { ReviewQueue } from './review-queue';

export const metadata: Metadata = { title: 'Review' };

/**
 * The finance review queue (task 3.4).
 *
 * **One question, not a filter builder.** The transactions screen can express
 * any conjunction of the four status axes; this one asks the single question
 * finance opens every morning — what has settled and nobody has looked at —
 * and answers it in one screen with no controls to set up first.
 *
 * **Bulk by default, because the work is bulk.** Twenty coffees from the same
 * merchant are one decision, and a queue that costs one round trip per row is
 * a queue that gets abandoned by Wednesday.
 */
export default async function ReviewPage(): Promise<React.JSX.Element> {
  const session = await getSession();

  if (session === null || !can(session, 'transaction:review')) {
    return (
      <>
        <PageHeader title="Review" />
        <Card>
          <PermissionState permission="transaction:review" />
        </Card>
      </>
    );
  }

  const pending = await apiFetch<OffsetCollection<TransactionRecord>>(
    '/transactions?status=POSTED&reviewStatus=PENDING&pageSize=100',
  );

  return (
    <>
      <PageHeader
        title="Review"
        description="Settled charges nobody has looked at yet. Select several and decide once."
        count={
          pending.pagination.totalCount === 0
            ? 'Nothing waiting'
            : `${String(pending.pagination.totalCount)} waiting`
        }
      />

      <Card>
        {pending.data.length === 0 ? (
          <div className="p-6">
            {/*
              No call to action: an empty review queue means finance is
              finished, and suggesting otherwise would imply it is not.
            */}
            <ScopeEmptyState
              title="Nothing to review"
              description="Every settled charge has been looked at. New ones appear here as they post."
            />
          </div>
        ) : (
          <ReviewQueue transactions={pending.data} />
        )}
      </Card>
    </>
  );
}

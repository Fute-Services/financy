import type { Metadata } from 'next';
import Link from 'next/link';
import {
  POLICY_STATUS_LABELS,
  SPEND_TYPE_LABELS,
  type PolicySummary,
  type Resource,
} from '@financy/contracts';
import {
  Badge,
  Card,
  DataTable,
  FirstRunEmptyState,
  PermissionState,
  StatusBadge,
  type Column,
} from '@financy/ui';

import { PageHeader } from '@/components/page-header';
import { apiFetch } from '@/lib/api';
import { can, getSession } from '@/lib/session';
import { NewPolicyButton } from './new-policy-button';

export const metadata: Metadata = { title: 'Policies' };

/**
 * Every spending policy, in the order they are evaluated.
 *
 * **Sorted by priority descending, because that is the order the engine runs
 * them in** — and the order matters more here than in any other list in the
 * product. A high-priority policy carrying a terminal rule stops everything
 * below it, so a list sorted alphabetically would hide the single most
 * important fact about a rule set: what gets a chance to run.
 *
 * The status column distinguishes three things a reader would otherwise
 * conflate. `Draft` has never been published and decides nothing. `Active` is
 * live. `Active` with an unpublished-changes marker is live *and* being edited
 * — the rules on the screen are not the rules deciding spend, and somebody
 * needs to know that before they trust what they are reading.
 */
export default async function PoliciesPage(): Promise<React.JSX.Element> {
  const session = await getSession();

  if (session === null || !can(session, 'policy:read')) {
    return (
      <>
        <PageHeader title="Policies" />
        <Card>
          <PermissionState permission="policy:read" />
        </Card>
      </>
    );
  }

  const canManage = can(session, 'policy:manage');
  const { data: policies } = await apiFetch<Resource<PolicySummary[]>>('/policies');

  const columns: ReadonlyArray<Column<PolicySummary>> = [
    {
      key: 'name',
      header: 'Policy',
      render: (policy) => (
        <div className="min-w-0">
          <Link
            href={`/policies/${policy.id}`}
            className="truncate font-medium text-ink-900 hover:text-cobalt-600 hover:underline"
          >
            {policy.name}
          </Link>
          {policy.description !== null && (
            <div className="truncate text-[12px] text-ink-500">{policy.description}</div>
          )}
        </div>
      ),
    },
    {
      key: 'applies',
      header: 'Applies to',
      render: (policy) => (
        <div className="flex flex-wrap gap-1">
          {policy.spendTypes.map((type) => (
            <Badge key={type} tone="neutral">
              {SPEND_TYPE_LABELS[type] ?? type}
            </Badge>
          ))}
        </div>
      ),
    },
    {
      key: 'priority',
      header: 'Priority',
      align: 'right',
      // Tabular figures, because the whole point of this column is comparing
      // one row against the one above it.
      render: (policy) => <span className="tabular text-ink-700">{policy.priority}</span>,
    },
    {
      key: 'rules',
      header: 'Rules',
      align: 'right',
      render: (policy) =>
        policy.ruleCount === 0 ? (
          // Named rather than shown as "0". A policy with no rules matches
          // nothing and looks in every other column exactly like one that
          // works — which is the silent failure this subsystem is built
          // against, so the list says it out loud.
          <Badge tone="warning">No rules</Badge>
        ) : (
          <span className="tabular text-ink-700">{policy.ruleCount}</span>
        ),
    },
    {
      key: 'status',
      header: 'Status',
      align: 'right',
      render: (policy) => (
        <div className="flex items-center justify-end gap-1.5">
          {policy.hasUnpublishedChanges && policy.status === 'ACTIVE' ? (
            <Badge
              tone="info"
              dot
              title="The rules on the editor differ from the ones deciding spend"
            >
              Draft changes
            </Badge>
          ) : null}
          <StatusBadge status={policy.status} label={POLICY_STATUS_LABELS[policy.status]} />
        </div>
      ),
    },
  ];

  const live = policies.filter((policy) => policy.status === 'ACTIVE').length;

  return (
    <>
      <PageHeader
        title="Policies"
        description="Rules evaluated before money is spent, in priority order. Higher runs first."
        count={`${String(live)} active of ${String(policies.length)}`}
        action={canManage ? <NewPolicyButton /> : undefined}
      />

      <Card>
        <DataTable
          columns={columns}
          rows={policies}
          rowKey={(policy) => policy.id}
          caption="Spending policies, highest priority first"
          emptyState={
            <FirstRunEmptyState
              title="No policies yet"
              description="Until a policy says otherwise, spend is allowed and nothing needs approval. A first policy usually sets an amount above which a manager has to agree."
            />
          }
        />
      </Card>
    </>
  );
}

import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  POLICY_STATUS_LABELS,
  SPEND_TYPE_LABELS,
  type OrganizationSettings,
  type PolicyDetail,
  type Resource,
} from '@financy/contracts';
import { Badge, Card, CardBody, CardHeader, PermissionState, StatusBadge } from '@financy/ui';

import { PageHeader } from '@/components/page-header';
import { ApiError, apiFetch } from '@/lib/api';
import { can, getSession } from '@/lib/session';
import { PolicyActions } from './policy-actions';
import { RuleEditor } from './rule-editor';
import { Simulator } from './simulator';
import { VersionHistory } from './version-history';

interface Props {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;

  try {
    const { data } = await apiFetch<Resource<PolicyDetail>>(`/policies/${id}`);
    return { title: data.name };
  } catch {
    return { title: 'Policy' };
  }
}

/**
 * One policy: its rules, its history, and a simulator.
 *
 * ## The three panels answer three different questions
 *
 * The editor answers "what will this do". The simulator answers "what would it
 * have done to *this* request". The history answers "what was it doing in
 * March". A policy screen that offered only the first is the one that gets
 * published untested, because there was nowhere else to find out.
 *
 * ## The simulator sits beside the editor, not behind a tab
 *
 * Editing a rule and testing it are one activity, and putting them on separate
 * screens is what makes "publish and see" the faster path. It runs against the
 * **draft**, in company with every other live policy — a rule tested alone
 * passes and then loses to a higher-priority policy nobody remembered.
 *
 * ## The unpublished banner is not decoration
 *
 * When a live policy has an open draft, the rules on this screen are not the
 * rules deciding spend. Somebody reading the editor to answer "why was this
 * blocked?" would otherwise reach a confident, wrong conclusion.
 */
export default async function PolicyPage({ params }: Props): Promise<React.JSX.Element> {
  const { id } = await params;
  const session = await getSession();

  if (session === null || !can(session, 'policy:read')) {
    return (
      <>
        <PageHeader title="Policy" />
        <Card>
          <PermissionState permission="policy:read" />
        </Card>
      </>
    );
  }

  let policy: PolicyDetail;

  try {
    policy = (await apiFetch<Resource<PolicyDetail>>(`/policies/${id}`)).data;
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }

  const settings = (await apiFetch<Resource<OrganizationSettings>>('/organization')).data;

  const canManage = can(session, 'policy:manage');
  const isLiveAndEdited = policy.status === 'ACTIVE' && policy.hasUnpublishedChanges;

  return (
    <>
      <div className="mb-1">
        <Link href="/policies" className="text-[13px] text-ink-500 hover:text-cobalt-600">
          ← Policies
        </Link>
      </div>

      <PageHeader
        title={policy.name}
        description={policy.description ?? undefined}
        action={canManage ? <PolicyActions policy={policy} /> : undefined}
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <StatusBadge status={policy.status} label={POLICY_STATUS_LABELS[policy.status]} />
        {policy.spendTypes.map((type) => (
          <Badge key={type} tone="neutral">
            {SPEND_TYPE_LABELS[type] ?? type}
          </Badge>
        ))}
        <Badge tone="neutral">Priority {policy.priority}</Badge>
        {policy.currentVersion !== null && (
          <Badge tone="neutral">Version {policy.currentVersion} live</Badge>
        )}
      </div>

      {isLiveAndEdited && (
        <div
          role="status"
          className="mb-4 rounded-[var(--radius-sm)] border border-[var(--color-warning-border)] bg-[var(--color-warning-fill)] px-3.5 py-2.5 text-[13px] text-[var(--color-warning-text)]"
        >
          <strong className="font-semibold">These rules are not deciding spend.</strong> Version{' '}
          {policy.currentVersion} is live; what you see below is an unpublished draft. Publish it to
          make it take effect.
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex min-w-0 flex-col gap-4">
          <RuleEditor
            policyId={policy.id}
            initialRules={policy.rules}
            baseCurrency={settings.organization.baseCurrency}
            departments={settings.departments}
            categories={settings.categories}
            entities={settings.entities}
            readOnly={!canManage || policy.status === 'ARCHIVED'}
          />

          <VersionHistory versions={policy.versions} currentVersion={policy.currentVersion} />
        </div>

        <div className="flex flex-col gap-4">
          <Simulator
            policyId={policy.id}
            spendTypes={policy.spendTypes}
            entities={settings.entities}
            categories={settings.categories}
            baseCurrency={settings.organization.baseCurrency}
          />

          <Card>
            <CardHeader title="How this is evaluated" />
            <CardBody className="flex flex-col gap-2.5 text-[13px] leading-relaxed text-ink-600">
              <p>
                Policies run in priority order, highest first. Within a policy, rules run in
                sequence. Ties break by id, never by insertion order — so the same request is
                decided the same way on two different days.
              </p>
              <p>
                A rule marked <strong className="font-medium text-ink-800">terminal</strong>, and
                any <strong className="font-medium text-ink-800">Block</strong>, stops everything —
                not just the rest of this policy.
              </p>
              <p>
                Requirements from every matching rule merge. The strictest wins: two approval steps
                at the same sequence become one step of the stricter kind, and the longer memo
                length is the one that applies.
              </p>
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}

import type { Metadata } from 'next';
import Link from 'next/link';
import type { OrganizationSettings, ProjectRecord, Resource } from '@financy/contracts';
import { Card, PermissionState } from '@financy/ui';

import { PageHeader } from '@/components/page-header';
import { apiFetch } from '@/lib/api';
import { can, getSession } from '@/lib/session';
import { RequestForm } from './request-form';

export const metadata: Metadata = { title: 'New spend request' };

/**
 * Raise a spend request.
 *
 * The form sits beside a **live policy preview**, and that pairing is the whole
 * design of this screen. Policy is evaluated authoritatively at submission
 * whatever happens here — but a requester who finds out only afterwards that
 * €12,000 needs three approvals, or that this category is blocked outright, has
 * been made to guess at rules the organisation already wrote down.
 *
 * The preview calls the same evaluator on the same context the server will
 * build. It is not a promise: the amount, the department, and the spend history
 * are re-read at submission, and the decision recorded there is the one that
 * counts.
 */
export default async function NewSpendRequestPage(): Promise<React.JSX.Element> {
  const session = await getSession();

  if (session === null || !can(session, 'spend_request:create')) {
    return (
      <>
        <PageHeader title="New spend request" />
        <Card>
          <PermissionState permission="spend_request:create" />
        </Card>
      </>
    );
  }

  // Issued together: three independent reads, and against a remote database
  // three sequential round trips is three times the latency for no consistency
  // anybody could observe.
  const [settings, projects] = await Promise.all([
    apiFetch<Resource<OrganizationSettings>>('/organization'),
    apiFetch<Resource<ProjectRecord[]>>('/projects').catch(() => ({
      // Projects are gated on `department:read`, which an employee does not
      // hold. An empty list is the honest result — the field is optional, and
      // failing the whole page over an optional picker would be absurd.
      data: [] as ProjectRecord[],
    })),
  ]);

  return (
    <>
      <div className="mb-1">
        <Link href="/spend" className="text-[13px] text-ink-500 hover:text-cobalt-600">
          ← My spend
        </Link>
      </div>

      <PageHeader
        title="New spend request"
        description="Ask before you spend. Policy decides at submission whether anybody has to agree."
      />

      <RequestForm
        entities={settings.data.entities}
        departments={settings.data.departments}
        categories={settings.data.categories}
        projects={projects.data}
        baseCurrency={settings.data.organization.baseCurrency}
        defaultDepartmentId={session.membership.departmentId}
      />
    </>
  );
}

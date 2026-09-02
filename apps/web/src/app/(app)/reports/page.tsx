import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReportSummary, Resource } from '@financy/contracts';
import { Card, CardBody, PermissionState } from '@financy/ui';

import { PageHeader } from '@/components/page-header';
import { apiFetch } from '@/lib/api';
import { can, getSession } from '@/lib/session';

export const metadata: Metadata = { title: 'Reports' };

/**
 * The report gallery.
 *
 * **Each card is titled with the question, not the noun.** "Spend by
 * department" tells somebody what a report is called; "Which teams are
 * spending?" tells them whether it is the one they want. People arrive at a
 * gallery with a question, not with a table name.
 *
 * **Reports the caller cannot run are shown, greyed, with the reason.** Hiding
 * them would make a colleague's screenshot of a report that does not exist for
 * you an unanswerable mystery; showing them says plainly that the answer is a
 * permission.
 */
export default async function ReportsPage(): Promise<React.JSX.Element> {
  const session = await getSession();

  if (session === null || !can(session, 'report:read')) {
    return (
      <>
        <PageHeader title="Reports" />
        <Card>
          <PermissionState permission="report:read" />
        </Card>
      </>
    );
  }

  const reports = await apiFetch<Resource<ReportSummary[]>>('/reports');

  const groups = [
    {
      title: 'Where the money went',
      keys: [
        'spend-total',
        'spend-by-department',
        'spend-by-category',
        'spend-by-vendor',
        'spend-by-person',
      ],
    },
    { title: 'Against the plan', keys: ['budget-vs-actual'] },
    {
      title: 'What is still open',
      keys: [
        'pending-approvals',
        'outstanding-reimbursements',
        'uncategorised-transactions',
        'missing-receipts',
      ],
    },
    { title: 'Where the rules bent', keys: ['policy-exceptions'] },
  ];

  return (
    <>
      <PageHeader
        title="Reports"
        description="Every figure is computed on the server, so what you see here is what an export contains."
      />

      <div className="flex flex-col gap-6">
        {groups.map((group) => {
          const entries = reports.data.filter((report) => group.keys.includes(report.key));

          if (entries.length === 0) return null;

          return (
            <section key={group.title}>
              <h2 className="mb-2 text-[12px] font-medium tracking-wide text-ink-500 uppercase">
                {group.title}
              </h2>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {entries.map((report) =>
                  report.available ? (
                    <Link key={report.key} href={`/reports/${report.key}`} className="block">
                      <Card className="h-full transition-colors hover:border-cobalt-300">
                        <CardBody>
                          <p className="text-[13px] font-medium text-ink-900">{report.question}</p>
                          <p className="mt-1 text-[12px] text-ink-500">{report.name}</p>
                        </CardBody>
                      </Card>
                    </Link>
                  ) : (
                    <Card key={report.key} className="h-full opacity-60">
                      <CardBody>
                        <p className="text-[13px] font-medium text-ink-700">{report.question}</p>
                        <p className="mt-1 text-[12px] text-ink-500">
                          {report.name} · needs {report.permission}
                        </p>
                      </CardBody>
                    </Card>
                  ),
                )}
              </div>
            </section>
          );
        })}
      </div>
    </>
  );
}

import type { Metadata } from 'next';
import Link from 'next/link';
import type { OrganizationSettings, Resource } from '@financy/contracts';
import { Card, PermissionState } from '@financy/ui';

import { PageHeader } from '@/components/page-header';
import { apiFetch } from '@/lib/api';
import { can, getSession } from '@/lib/session';
import { ExpenseForm } from './expense-form';

export const metadata: Metadata = { title: 'New expense' };

/**
 * File a claim.
 *
 * Receipt first, because that is the order the work happens in: the photograph
 * exists before the claim does, and policy can require it before the claim can
 * be submitted.
 */
export default async function NewExpensePage(): Promise<React.JSX.Element> {
  const session = await getSession();

  if (session === null || !can(session, 'expense:create')) {
    return (
      <>
        <PageHeader title="New expense" />
        <Card>
          <PermissionState permission="expense:create" />
        </Card>
      </>
    );
  }

  const settings = await apiFetch<Resource<OrganizationSettings>>('/organization');

  return (
    <>
      <div className="mb-1">
        <Link href="/expenses" className="text-[13px] text-ink-500 hover:text-cobalt-600">
          ← Expenses
        </Link>
      </div>

      <PageHeader
        title="New expense"
        description="Money you have already spent. Attach the receipt, say what it was, and submit."
      />

      <ExpenseForm
        entities={settings.data.entities}
        departments={settings.data.departments}
        categories={settings.data.categories}
        baseCurrency={settings.data.organization.baseCurrency}
      />
    </>
  );
}

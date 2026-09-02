import type { Metadata } from 'next';
import Link from 'next/link';
import type {
  EntitySummary,
  OffsetCollection,
  Resource,
  VendorRecord,
} from '@financy/contracts';
import { Card, PermissionState } from '@financy/ui';

import { PageHeader } from '@/components/page-header';
import { apiFetch } from '@/lib/api';
import { can, getSession } from '@/lib/session';
import { BillForm } from './bill-form';

export const metadata: Metadata = { title: 'Enter a bill' };

/**
 * Entering a supplier invoice.
 *
 * Only **active** suppliers are offered. A merged one would be refused by the
 * server, and a dropdown that lists an option the server rejects is a form that
 * wastes somebody's typing to teach them a rule the list could have expressed.
 */
export default async function NewBillPage(): Promise<React.JSX.Element> {
  const session = await getSession();

  if (session === null || !can(session, 'bill:create')) {
    return (
      <>
        <PageHeader title="Enter a bill" />
        <Card>
          <PermissionState permission="bill:create" />
        </Card>
      </>
    );
  }

  const [vendors, entities] = await Promise.all([
    apiFetch<OffsetCollection<VendorRecord>>('/vendors?status=ACTIVE&pageSize=100'),
    apiFetch<Resource<EntitySummary[]>>('/entities'),
  ]);

  return (
    <>
      <div className="mb-1">
        <Link href="/bills" className="text-[13px] text-ink-500 hover:text-cobalt-600">
          ← Bills
        </Link>
      </div>

      <PageHeader
        title="Enter a bill"
        description="The supplier's invoice number is unique per supplier — that index is what stops the same invoice being paid twice."
      />

      <BillForm
        vendors={vendors.data}
        entities={entities.data}
        baseCurrency={session.organization.baseCurrency}
      />
    </>
  );
}

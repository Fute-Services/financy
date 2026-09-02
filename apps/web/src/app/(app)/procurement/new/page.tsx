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
import { OrderForm } from './order-form';

export const metadata: Metadata = { title: 'Raise a purchase order' };

/**
 * Raising an order.
 *
 * The form asks for quantities as well as prices, which is what separates a
 * purchase order from a spend request: a receipt against it later has to be
 * able to say "six of the ten arrived", and that is impossible if the order
 * only recorded a total.
 */
export default async function NewOrderPage(): Promise<React.JSX.Element> {
  const session = await getSession();

  if (session === null || !can(session, 'purchase_order:create')) {
    return (
      <>
        <PageHeader title="Raise a purchase order" />
        <Card>
          <PermissionState permission="purchase_order:create" />
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
        <Link href="/procurement" className="text-[13px] text-ink-500 hover:text-cobalt-600">
          ← Procurement
        </Link>
      </div>

      <PageHeader
        title="Raise a purchase order"
        description="Once approved, this reserves its value against the budget it falls in — before anything is bought."
      />

      <OrderForm
        vendors={vendors.data}
        entities={entities.data}
        baseCurrency={session.organization.baseCurrency}
      />
    </>
  );
}

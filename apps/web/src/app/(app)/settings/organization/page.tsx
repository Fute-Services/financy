import type { Metadata } from 'next';
import type { OrganizationSettings, Resource } from '@financy/contracts';
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  DataTable,
  PermissionState,
  type Column,
} from '@financy/ui';

import { PageHeader } from '@/components/page-header';
import { apiFetch } from '@/lib/api';
import { can, getSession } from '@/lib/session';

export const metadata: Metadata = { title: 'Settings' };

type Entity = OrganizationSettings['entities'][number];
type Department = OrganizationSettings['departments'][number];
type RoleCount = OrganizationSettings['roleCounts'][number];

/**
 * Organisation settings.
 *
 * Everything on this screen is read from one call, because it is one screen —
 * four endpoints would render it in four stages with three intermediate states
 * nobody designed.
 *
 * Read-only for now, and the fields say so rather than presenting inputs that
 * discard what you type. Editing needs optimistic concurrency (two admins on
 * the same form is not a rare case), an audit event per change, and a base
 * currency that locks the moment a financial record exists. Task 1.5.
 */
export default async function OrganizationSettingsPage(): Promise<React.JSX.Element> {
  const session = await getSession();

  if (session === null || !can(session, 'organization:read')) {
    return (
      <>
        <PageHeader title="Settings" />
        <Card>
          <PermissionState permission="organization:read" />
        </Card>
      </>
    );
  }

  const { data } = await apiFetch<Resource<OrganizationSettings>>('/organization');
  const { organization, entities, departments, categories, roleCounts } = data;

  const entityColumns: ReadonlyArray<Column<Entity>> = [
    { key: 'name', header: 'Entity', render: (e) => <span className="font-medium">{e.name}</span> },
    { key: 'country', header: 'Country', render: (e) => e.countryCode },
    {
      key: 'currency',
      header: 'Functional currency',
      render: (e) => <span className="tabular">{e.functionalCurrency}</span>,
    },
    {
      key: 'registration',
      header: 'Registration',
      render: (e) => e.registrationNumber ?? <span className="text-ink-400">—</span>,
    },
    {
      key: 'status',
      header: 'Status',
      align: 'right',
      render: (e) => <Badge tone={e.status === 'ACTIVE' ? 'success' : 'neutral'}>{e.status}</Badge>,
    },
  ];

  const departmentColumns: ReadonlyArray<Column<Department>> = [
    {
      key: 'name',
      header: 'Department',
      render: (d) => (
        // Indented by depth. The API returns departments ordered by their
        // materialised path, so a parent always precedes its children and
        // this renders the tree without any client-side sorting.
        <span style={{ paddingLeft: `${String(d.depth * 20)}px` }} className="font-medium">
          {d.name}
        </span>
      ),
    },
    {
      key: 'code',
      header: 'Code',
      render: (d) =>
        d.code === null ? <span className="text-ink-400">—</span> : <code>{d.code}</code>,
    },
    {
      key: 'members',
      header: 'Members',
      align: 'right',
      render: (d) => <span className="tabular">{d.memberCount}</span>,
    },
  ];

  const roleColumns: ReadonlyArray<Column<RoleCount>> = [
    { key: 'name', header: 'Role', render: (r) => <span className="font-medium">{r.name}</span> },
    {
      key: 'description',
      header: 'What it means',
      render: (r) => <span className="text-ink-600">{r.description}</span>,
    },
    {
      key: 'permissions',
      header: 'Permissions',
      align: 'right',
      render: (r) => <span className="tabular text-ink-600">{r.permissionCount}</span>,
    },
    {
      key: 'members',
      header: 'People',
      align: 'right',
      render: (r) => <span className="tabular">{r.memberCount}</span>,
    },
  ];

  return (
    <>
      <PageHeader
        title="Settings"
        description="The organisation, its legal entities, its structure, and what each role can do."
      />

      <div className="space-y-6">
        <Card>
          <CardHeader title="Organisation" />
          <CardBody>
            <dl className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
              <Detail label="Name" value={organization.name} />
              <Detail label="Legal name" value={organization.legalName} />
              <Detail label="Identifier" value={organization.slug} mono />
              <Detail
                label="Base currency"
                value={organization.baseCurrency}
                mono
                // The lock is explained rather than merely applied. A greyed
                // field with no reason is the kind of thing people file
                // support tickets about.
                note={
                  organization.baseCurrencyLocked
                    ? 'Locked — financial records exist in this currency.'
                    : 'Can still be changed until the first financial record.'
                }
              />
              <Detail label="Country" value={organization.countryCode} mono />
              <Detail label="Timezone" value={organization.timezone} />
              <Detail
                label="Fiscal year starts"
                value={MONTHS[organization.fiscalYearStartMonth - 1] ?? '—'}
              />
              <Detail
                label="Created"
                value={new Date(organization.createdAt).toLocaleDateString('en-GB', {
                  day: 'numeric',
                  month: 'long',
                  year: 'numeric',
                })}
              />
            </dl>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Legal entities"
            description="Each entity has its own functional currency; spend is recorded against one of them."
          />
          <DataTable
            columns={entityColumns}
            rows={entities}
            rowKey={(entity) => entity.id}
            caption="Legal entities"
            density="compact"
          />
        </Card>

        <Card>
          <CardHeader
            title="Departments"
            description="The approval chain and every manager-scoped view follow this tree."
          />
          <DataTable
            columns={departmentColumns}
            rows={departments}
            rowKey={(department) => department.id}
            caption="Departments"
            density="compact"
          />
        </Card>

        <Card>
          <CardHeader
            title="Roles"
            description="Fixed for now. Custom roles are a later phase; these five cover the standard split of duties."
          />
          <DataTable
            columns={roleColumns}
            rows={roleCounts}
            rowKey={(role) => role.key}
            caption="Roles"
            density="compact"
          />
        </Card>

        <Card>
          <CardHeader
            title="Spend categories"
            description={`${String(categories.length)} categories. System categories cannot be renamed or removed — reports and accounting exports map to them.`}
          />
          <CardBody>
            <ul className="grid grid-cols-1 gap-x-8 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
              {categories.map((category) => (
                <li
                  key={category.id}
                  className="flex items-center justify-between gap-2 py-0.5 text-[13px]"
                  style={{ paddingLeft: `${String(category.depth * 16)}px` }}
                >
                  <span
                    className={category.depth === 0 ? 'font-medium text-ink-800' : 'text-ink-600'}
                  >
                    {category.name}
                  </span>
                  {category.isSystem && <span className="text-[11px] text-ink-400">system</span>}
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      </div>
    </>
  );
}

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

function Detail({
  label,
  value,
  note,
  mono = false,
}: {
  label: string;
  value: string | null;
  note?: string;
  mono?: boolean;
}): React.JSX.Element {
  return (
    <div>
      <dt className="text-[12px] font-medium text-ink-500">{label}</dt>
      <dd className={`mt-0.5 text-[13px] text-ink-900 ${mono ? 'tabular' : ''}`}>
        {value ?? <span className="text-ink-400">Not set</span>}
      </dd>
      {note !== undefined && <p className="mt-0.5 text-[11px] text-ink-400">{note}</p>}
    </div>
  );
}

import type { Metadata } from 'next';
import type {
  CategoryRecord,
  DepartmentRecord,
  EntityRecord,
  OrganizationSettings,
  Resource,
} from '@financy/contracts';
import { Card, CardBody, CardHeader, DataTable, PermissionState, type Column } from '@financy/ui';

import { PageHeader } from '@/components/page-header';
import { apiFetch } from '@/lib/api';
import { can, getSession } from '@/lib/session';
import { DepartmentsPanel } from './departments-panel';
import { EntitiesPanel } from './entities-panel';
import { OrganizationForm } from './organization-form';

export const metadata: Metadata = { title: 'Settings' };

type RoleCount = OrganizationSettings['roleCounts'][number];

/**
 * Organisation settings.
 *
 * **Two calls, not one, and the second one is why.** `GET /organization`
 * returns everything the screen shows and is enough to *render* it; but its
 * entities and departments carry no `version`, because a summary payload for
 * a read-only screen had no need of one. A form does: the version is the
 * precondition that stops one administrator's save discarding another's, and
 * a screen that had to guess a version would have no precondition at all. So
 * the panels that write read from `/entities` and `/departments`, which
 * return the record shape with the version on it.
 *
 * Issued together rather than in sequence — they are independent, and against
 * a remote database three sequential round trips is three times the latency
 * for no consistency anybody can observe.
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

  const canManageEntities = can(session, 'entity:manage');
  const canManageDepartments = can(session, 'department:manage');
  const canUpdateOrganization = can(session, 'organization:update');
  const canReadCategories = can(session, 'policy:read');

  const [settings, entities, departments, categories] = await Promise.all([
    apiFetch<Resource<OrganizationSettings>>('/organization'),
    apiFetch<Resource<EntityRecord[]>>('/entities'),
    apiFetch<Resource<DepartmentRecord[]>>('/departments'),
    // Categories are gated on `policy:read`, which an employee does not hold.
    // Asking anyway would turn the whole page into a 403 for them, so the
    // section is skipped rather than the screen being lost.
    canReadCategories
      ? apiFetch<Resource<CategoryRecord[]>>('/categories')
      : Promise.resolve({ data: [] as CategoryRecord[] }),
  ]);

  const { organization, roleCounts } = settings.data;

  // Member counts come from the settings payload, which is already reading
  // every membership to tally roles; the departments endpoint would have to
  // issue a second query to invent them.
  const memberCounts = new Map(
    settings.data.departments.map((department) => [department.id, department.memberCount]),
  );

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
          <CardHeader
            title="Organisation"
            description={
              canUpdateOrganization
                ? undefined
                : 'Read-only — changing these needs the organisation:update permission.'
            }
          />
          <CardBody>
            <OrganizationForm organization={organization} canEdit={canUpdateOrganization} />
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Legal entities"
            description="Each entity has its own functional currency; spend is recorded against one of them."
          />
          <EntitiesPanel entities={entities.data} canManage={canManageEntities} />
        </Card>

        <Card>
          <CardHeader
            title="Departments"
            description="The approval chain and every manager-scoped view follow this tree."
          />
          <DepartmentsPanel
            departments={departments.data}
            memberCounts={Object.fromEntries(memberCounts)}
            canManage={canManageDepartments}
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

        {canReadCategories ? (
          <Card>
            <CardHeader
              title="Spend categories"
              description={`${String(categories.data.length)} categories. A category's key is what a policy names, so it is fixed once created — the display name is not.`}
            />
            <CardBody>
              <ul className="grid grid-cols-1 gap-x-8 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
                {categories.data.map((category) => (
                  <li
                    key={category.id}
                    className="flex items-center justify-between gap-2 py-0.5 text-[13px]"
                    style={{ paddingLeft: `${String(category.depth * 16)}px` }}
                  >
                    <span
                      className={
                        category.archivedAt !== null
                          ? 'text-ink-400 line-through'
                          : category.depth === 0
                            ? 'font-medium text-ink-800'
                            : 'text-ink-600'
                      }
                    >
                      {category.name}
                    </span>
                    {category.isSystem ? (
                      <span className="text-[11px] text-ink-400">system</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>
        ) : null}
      </div>
    </>
  );
}

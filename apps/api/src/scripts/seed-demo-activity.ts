/**
 * Fill the demo organisation with a working month.
 *
 * ## Why this drives the HTTP API instead of writing rows
 *
 * Every record this creates has a state machine behind it: submitting an
 * expense evaluates policy, approving a purchase order commits budget, posting
 * a charge moves a ledger. Writing rows directly would produce a database that
 * *looks* populated and a set of screens that disagree with it — budgets at
 * zero beside spent transactions, approval chains with no steps, dashboards
 * whose totals nothing explains.
 *
 * Going through the API is slower to run and the only way to get demo data
 * that behaves like real data. It also means this script exercises the
 * application end to end, so a broken flow fails here rather than in front of
 * somebody.
 *
 * ## What it deliberately leaves half-finished
 *
 * Some transactions are unreviewed and uncategorised, some invoices are
 * overdue, some claims sit awaiting approval, and one purchase order is only
 * partly delivered. A demo where everything is complete shows none of the
 * screens that exist to handle incompleteness — the review queue, the close
 * checklist, the approvals inbox — and those are the screens the product is
 * actually for.
 *
 * Run: `pnpm --filter @financy/api seed:demo:activity` with the API running.
 */

import { DEMO_PASSWORD } from '@financy/db';

const API = process.env['API_BASE_URL'] ?? 'http://localhost:4100';

function isDemoAllowed(): boolean {
  const appEnv = process.env['APP_ENV'] ?? 'local';
  return appEnv === 'local' || appEnv === 'test' || appEnv === 'development';
}

// ── a tiny HTTP client that keeps one person's cookie ──────────────────────

interface Session {
  readonly label: string;
  readonly cookie: string;
  readonly membershipId: string;
  /**
   * Which organisation this session actually landed in.
   *
   * A person can belong to more than one, and login resolves *one* of them —
   * there is no switch endpoint yet. Seeding through a session that resolved
   * to a different organisation than the rest is how you end up with a demo
   * split across two tenants, each half-populated.
   */
  readonly organizationId: string;
  readonly organizationName: string;
}

async function call<T>(
  session: Session | null,
  method: string,
  path: string,
  body?: unknown,
  version?: number,
): Promise<T> {
  const response = await fetch(`${API}/v1${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(session === null ? {} : { Cookie: session.cookie }),
      ...(version === undefined ? {} : { 'If-Match': String(version) }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

  const text = await response.text();

  if (!response.ok) {
    throw new Error(
      `${method} ${path} → ${String(response.status)}\n${text.slice(0, 600)}`,
    );
  }

  return text === '' ? (undefined as T) : (JSON.parse(text) as T);
}

async function signIn(email: string, password = DEMO_PASSWORD): Promise<Session> {
  const response = await fetch(`${API}/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });

  if (!response.ok) {
    throw new Error(`Could not sign in as ${email}: ${String(response.status)}`);
  }

  const raw = response.headers.getSetCookie?.() ?? [];
  const cookie = raw.map((value) => value.split(';')[0]).join('; ');
  const body = (await response.json()) as {
    membership: { id: string };
    organization: { id: string; name: string };
  };

  return {
    label: email,
    cookie,
    membershipId: body.membership.id,
    organizationId: body.organization.id,
    organizationName: body.organization.name,
  };
}

/** Deterministic pseudo-randomness, so two runs produce the same demo. */
let seed = 20_260_902;

function random(): number {
  seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
  return seed / 2_147_483_648;
}

function pick<T>(items: readonly T[]): T {
  const item = items[Math.floor(random() * items.length)];
  if (item === undefined) throw new Error('pick from an empty list');
  return item;
}

function money(low: number, high: number): string {
  return (low + random() * (high - low)).toFixed(2);
}

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 86_400_000);
}

function day(date: Date): string {
  return date.toISOString().slice(0, 10);
}

// ── the shape of a plausible month ────────────────────────────────────────

const MERCHANTS: readonly { name: string; category: string; low: number; high: number }[] = [
  { name: 'Amazon Web Services', category: 'software_cloud', low: 400, high: 3200 },
  { name: 'GitHub', category: 'software_saas', low: 40, high: 900 },
  { name: 'Figma', category: 'software_saas', low: 45, high: 480 },
  { name: 'Slack', category: 'software_saas', low: 80, high: 720 },
  { name: 'Notion Labs', category: 'software_saas', low: 32, high: 260 },
  { name: 'Datadog', category: 'software_cloud', low: 210, high: 1800 },
  { name: 'Apple Store', category: 'equipment_computers', low: 900, high: 3400 },
  { name: 'Dell Technologies', category: 'equipment_computers', low: 700, high: 2600 },
  { name: 'Logitech', category: 'equipment_peripherals', low: 45, high: 320 },
  { name: 'IKEA Business', category: 'equipment_furniture', low: 180, high: 1400 },
  { name: 'British Airways', category: 'travel_airfare', low: 220, high: 1650 },
  { name: 'Lufthansa', category: 'travel_airfare', low: 180, high: 1400 },
  { name: 'Marriott Hotels', category: 'travel_accommodation', low: 160, high: 980 },
  { name: 'Premier Inn', category: 'travel_accommodation', low: 78, high: 340 },
  { name: 'Uber', category: 'travel_ground', low: 9, high: 85 },
  { name: 'Trainline', category: 'travel_ground', low: 22, high: 260 },
  { name: 'Pret A Manger', category: 'meals_team', low: 12, high: 140 },
  { name: 'Dishoom', category: 'meals_client', low: 60, high: 420 },
  { name: 'Deliveroo', category: 'meals_team', low: 24, high: 180 },
  { name: 'LinkedIn Talent', category: 'professional_recruiting', low: 400, high: 2800 },
  { name: 'Google Ads', category: 'marketing_advertising', low: 300, high: 4200 },
  { name: 'Meta Ads', category: 'marketing_advertising', low: 250, high: 3100 },
  { name: 'Eventbrite', category: 'marketing_events', low: 120, high: 1600 },
  { name: 'WeWork', category: 'office_rent', low: 800, high: 4200 },
  { name: 'Officeworks', category: 'office_supplies', low: 20, high: 260 },
  { name: 'Vodafone Business', category: 'telecoms', low: 90, high: 620 },
];

const NEW_PEOPLE: readonly { email: string; fullName: string; roleKey: string; dept: string }[] = [
  { email: 'priya.nair@acme.test', fullName: 'Priya Nair', roleKey: 'MANAGER', dept: 'SAL' },
  { email: 'tom.blake@acme.test', fullName: 'Tom Blake', roleKey: 'MANAGER', dept: 'MKT' },
  { email: 'sara.iqbal@acme.test', fullName: 'Sara Iqbal', roleKey: 'EMPLOYEE', dept: 'ENG-PLT' },
  { email: 'leo.marchetti@acme.test', fullName: 'Leo Marchetti', roleKey: 'EMPLOYEE', dept: 'ENG-APP' },
  { email: 'nina.okafor@acme.test', fullName: 'Nina Okafor', roleKey: 'EMPLOYEE', dept: 'SAL' },
  { email: 'james.wu@acme.test', fullName: 'James Wu', roleKey: 'EMPLOYEE', dept: 'MKT' },
  { email: 'aisha.rahman@acme.test', fullName: 'Aisha Rahman', roleKey: 'EMPLOYEE', dept: 'OPS' },
  { email: 'daniel.stone@acme.test', fullName: 'Daniel Stone', roleKey: 'EMPLOYEE', dept: 'ENG-PLT' },
];

const VENDORS: readonly { name: string; terms: number; category: string }[] = [
  { name: 'Northwind Consulting', terms: 30, category: 'professional_consulting' },
  { name: 'Blue Harbour Legal', terms: 14, category: 'professional_legal' },
  { name: 'Kestrel Accounting', terms: 30, category: 'professional_accounting' },
  { name: 'Meridian Facilities', terms: 45, category: 'office_rent' },
  { name: 'Copperleaf Design Studio', terms: 21, category: 'marketing_content' },
  { name: 'Halcyon Cloud Partners', terms: 30, category: 'software_cloud' },
  { name: 'Ridgeway Office Supplies', terms: 14, category: 'office_supplies' },
  { name: 'Summit Recruitment', terms: 30, category: 'professional_recruiting' },
];

interface Named {
  id: string;
  name?: string;
  key?: string;
  code?: string | null;
}

async function main(): Promise<void> {
  if (!isDemoAllowed()) {
    throw new Error(
      `Refusing to seed demo activity with APP_ENV=${process.env['APP_ENV'] ?? 'unset'}.`,
    );
  }

  const log = (message: string): void => {
    console.warn(message);
  };

  log(`Seeding demo activity against ${API}\n`);

  const finance = await signIn('finance@acme.test');
  const employee = await signIn('employee@acme.test');
  const manager = await signIn('manager@acme.test');

  log(`Filling "${finance.organizationName}"\n`);

  /**
   * Inviting needs `user:invite`, which finance does not hold — it is an
   * administrator's power, deliberately. The administrator account belongs to
   * two organisations and login resolves the wrong one, so the invitations are
   * attempted and skipped rather than silently seeding a second tenant.
   */
  const admin = await signIn('demo@financy.app').catch(() => null);
  const canInvite = admin !== null && admin.organizationId === finance.organizationId;

  // ── the structure we are hanging everything off ─────────────────────────

  const entities = (await call<{ data: Named[] }>(finance, 'GET', '/entities')).data;
  const departments = (await call<{ data: Named[] }>(finance, 'GET', '/departments')).data;
  const categories = (await call<{ data: Named[] }>(finance, 'GET', '/categories')).data;

  const entity = entities[0];
  if (entity === undefined) throw new Error('the demo organisation has no entity');

  const categoryByKey = new Map(categories.map((row) => [row.key ?? '', row.id]));
  const departmentByCode = new Map(departments.map((row) => [row.code ?? '', row.id]));

  const engineering = departmentByCode.get('ENG') ?? departments[0]?.id;
  if (engineering === undefined) throw new Error('the demo organisation has no department');

  // ── people, so the screens have more than five names on them ────────────

  let peopleAdded = 0;

  for (const person of canInvite && admin !== null ? NEW_PEOPLE : []) {
    try {
      const invitation = await call<{ data: { token: string } }>(
        admin,
        'POST',
        '/memberships/invitations',
        {
          email: person.email,
          roleKey: person.roleKey,
          ...(departmentByCode.has(person.dept)
            ? { departmentId: departmentByCode.get(person.dept) }
            : {}),
        },
      );

      await call(null, 'POST', '/auth/invitations/accept', {
        token: invitation.data.token,
        fullName: person.fullName,
        password: DEMO_PASSWORD,
      });

      peopleAdded += 1;
    } catch {
      // Already invited on a previous run. Re-inviting is refused, and that
      // refusal is correct — it should not stop the rest of the seed.
    }
  }

  log(
    canInvite
      ? `people        +${String(peopleAdded)}`
      : 'people        skipped — the administrator account resolves to another organisation',
  );

  const roster = (
    await call<{ data: { id: string; fullName: string; email: string; roleKey: string }[] }>(
      finance,
      'GET',
      '/memberships?pageSize=100',
    )
  ).data;

  const holders = roster.filter((person) => person.roleKey !== 'AUDITOR');

  // ── a policy, so approvals actually route somewhere ─────────────────────

  let policiesAdded = 0;

  try {
    const policy = await call<{ data: { id: string; version: number } }>(
      finance,
      'POST',
      '/policies',
      {
        name: 'Spending approvals',
        description: 'What has to be agreed before money moves, and by whom.',
        spendTypes: ['SPEND_REQUEST', 'REIMBURSEMENT', 'CARD', 'BILL', 'PURCHASE_ORDER'],
        priority: 100,
      },
    );

    const withRules = await call<{ data: { version: number } }>(
      finance,
      'POST',
      `/policies/${policy.data.id}/rules`,
      {
      rules: [
        {
          name: 'Anything over 1,000 goes to finance',
          sequence: 1,
          terminal: false,
          condition: {
            type: 'COMPARISON',
            field: 'amountInBaseCurrency',
            operator: 'GT',
            value: { kind: 'money', amount: '1000.00', currency: 'USD' },
          },
          outcomes: [
            {
              type: 'REQUIRE_APPROVER',
              approver: { kind: 'ROLE', roleKey: 'FINANCE_ADMIN', scope: 'ORGANIZATION' },
              stepType: 'SINGLE',
              sequence: 1,
              timeoutHours: 48,
            },
          ],
        },
        {
          name: 'Over 10,000 needs a receipt as well',
          sequence: 2,
          terminal: false,
          condition: {
            type: 'COMPARISON',
            field: 'amountInBaseCurrency',
            operator: 'GT',
            value: { kind: 'money', amount: '10000.00', currency: 'USD' },
          },
          outcomes: [{ type: 'REQUIRE_RECEIPT' }],
        },
      ],
      },
      policy.data.version,
    );

    await call(
      finance,
      'POST',
      `/policies/${policy.data.id}/publish`,
      { note: 'The starting set: finance sees anything over a thousand.' },
      withRules.data.version,
    );

    policiesAdded = 1;
  } catch {
    // Already published on a previous run.
  }

  log(`policies      +${String(policiesAdded)}`);

  // ── cards ───────────────────────────────────────────────────────────────

  const existingCards = (
    await call<{ data: { id: string; departmentId: string | null; version: number }[] }>(
      finance,
      'GET',
      '/cards?pageSize=100',
    )
  ).data;

  const cardIds: string[] = existingCards.map((card) => card.id);

  /** Spread across the departments that have budgets, so charges land in them. */
  const cardDepartments = ['ENG', 'SAL', 'MKT', 'OPS', 'FIN']
    .map((code) => departmentByCode.get(code))
    .filter((id): id is string => id !== undefined);

  if (existingCards.length === 0) {
    for (const [index, person] of holders.slice(0, 8).entries()) {
      const card = await call<{ data: { id: string } }>(finance, 'POST', '/cards', {
        name: `${person.fullName.split(' ')[0] ?? 'Team'} — company card`,
        cardType: 'VIRTUAL',
        holderMembershipId: person.id,
        entityId: entity.id,
        // A charge inherits its department from the card it was made on, and
        // that inheritance is what makes a departmental budget move at all.
        ...(cardDepartments.length === 0
          ? {}
          : { departmentId: cardDepartments[index % cardDepartments.length] }),
        limit: { amount: pick(['2500.00', '5000.00', '10000.00']), currency: 'USD' },
        limitPeriod: 'MONTHLY',
      });

      cardIds.push(card.data.id);
    }
  } else {
    // Older runs issued cards with no department. Fixing them here means a
    // re-run repairs a demo rather than needing one built from scratch.
    for (const [index, card] of existingCards.entries()) {
      if (card.departmentId !== null || cardDepartments.length === 0) continue;

      try {
        await call(
          finance,
          'PATCH',
          `/cards/${card.id}`,
          { departmentId: cardDepartments[index % cardDepartments.length] },
          card.version,
        );
      } catch {
        // Locked or terminated. Leave it alone.
      }
    }
  }

  log(`cards         ${String(cardIds.length)} total`);

  // ── six months of card spend ────────────────────────────────────────────

  const stamp = Date.now().toString(36);

  const alreadyImported = (
    await call<{ pagination: { totalCount: number } }>(
      finance,
      'GET',
      '/transactions?pageSize=1',
    )
  ).pagination.totalCount;

  const rows: Record<string, unknown>[] = [];

  // Enough is enough. Re-running should top up what is missing, not multiply
  // what is there.
  const TARGET = 340;
  const wanted = alreadyImported >= TARGET ? 0 : TARGET - alreadyImported;

  for (let index = 0; index < wanted; index += 1) {
    const merchant = pick(MERCHANTS);
    const occurred = daysAgo(Math.floor(random() * 170));

    rows.push({
      providerTransactionId: `demo-${stamp}-${String(index)}`,
      cardId: cardIds.length === 0 ? null : pick(cardIds),
      entityId: entity.id,
      merchantName: merchant.name,
      amount: { amount: money(merchant.low, merchant.high), currency: 'USD' },
      occurredAt: occurred.toISOString(),
      postedAt: occurred.toISOString(),
      // A tenth are still authorisations. They are excluded from every spend
      // figure, which is a difference worth being able to see on screen.
      status: random() < 0.1 ? 'PENDING' : 'POSTED',
    });
  }

  const imported =
    rows.length === 0
      ? { data: { imported: 0 } }
      : await call<{ data: { imported: number } }>(finance, 'POST', '/transactions/import', {
          provider: 'demo-bank',
          rows,
          autoMatch: false,
        });

  log(
    `transactions  +${String(imported.data.imported)} (${String(alreadyImported + imported.data.imported)} total)`,
  );

  // ── code and review most of them, and deliberately not all ──────────────

  const posted = (
    await call<{ data: { id: string; version: number; merchantName: string }[] }>(
      finance,
      'GET',
      '/transactions?status=POSTED&pageSize=100',
    )
  ).data;

  let coded = 0;
  let reviewed = 0;

  for (const transaction of posted) {
    // A quarter are left alone on purpose: the review queue and the close
    // checklist are screens about the work that is *not* done.
    if (random() < 0.25) continue;

    const merchant = MERCHANTS.find((entry) => entry.name === transaction.merchantName);
    const categoryId = categoryByKey.get(merchant?.category ?? 'uncategorised');

    if (categoryId === undefined) continue;

    try {
      const categorised = await call<{ data: { version: number } }>(
        finance,
        'PATCH',
        `/transactions/${transaction.id}`,
        { categoryId, departmentId: pick([...departmentByCode.values()]) },
        transaction.version,
      );
      coded += 1;

      if (random() < 0.8) {
        await call(
          finance,
          'POST',
          `/transactions/${transaction.id}/review`,
          { reviewStatus: 'REVIEWED' },
          categorised.data.version,
        );
        reviewed += 1;
      }
    } catch {
      // A row that moved underneath us. The next run picks it up.
    }
  }

  log(`  coded       ${String(coded)}, reviewed ${String(reviewed)}`);

  // ── budgets, so the meters have something to measure ────────────────────

  const year = new Date().getUTCFullYear();
  let budgetsAdded = 0;

  const budgetPlan: { name: string; scopeType: string; scopeId?: string; total: string }[] = [
    { name: 'Engineering', scopeType: 'DEPARTMENT', scopeId: engineering, total: '240000.00' },
    {
      name: 'Sales',
      scopeType: 'DEPARTMENT',
      scopeId: departmentByCode.get('SAL') ?? engineering,
      total: '120000.00',
    },
    {
      name: 'Marketing',
      scopeType: 'DEPARTMENT',
      scopeId: departmentByCode.get('MKT') ?? engineering,
      total: '90000.00',
    },
    { name: 'Company-wide', scopeType: 'ORGANIZATION', total: '600000.00' },
  ];

  for (const plan of budgetPlan) {
    try {
      const created = await call<{ data: { id: string; version: number } }>(
        finance,
        'POST',
        '/budgets',
        {
          name: `${plan.name} ${String(year)}`,
          scopeType: plan.scopeType,
          ...(plan.scopeId === undefined ? {} : { scopeId: plan.scopeId }),
          entityId: entity.id,
          currency: 'USD',
          periodStart: `${String(year)}-01-01`,
          periodEnd: `${String(year)}-12-31`,
          periodGranularity: 'MONTHLY',
          overspendBehavior: plan.name === 'Marketing' ? 'REQUIRE_APPROVAL' : 'WARN',
          totalAllocated: { amount: plan.total, currency: 'USD' },
        },
      );

      await call(
        finance,
        'PATCH',
        `/budgets/${created.data.id}`,
        { status: 'ACTIVE' },
        created.data.version,
      );

      budgetsAdded += 1;
    } catch {
      // Already there from a previous run.
    }
  }

  log(`budgets       +${String(budgetsAdded)}`);

  // ── claims, in every state a claim can be in ────────────────────────────

  let expensesAdded = 0;
  let expensesSubmitted = 0;

  const claimants = [employee, manager];

  for (let index = 0; index < 26; index += 1) {
    const person = pick(claimants);
    const merchant = pick(MERCHANTS);
    const categoryId = categoryByKey.get(merchant.category);

    try {
      const expense = await call<{ data: { id: string; version: number } }>(
        person,
        'POST',
        '/expenses',
        {
          paymentMethod: 'OUT_OF_POCKET',
          entityId: entity.id,
          merchantName: merchant.name,
          amount: { amount: money(18, 900), currency: 'USD' },
          expenseDate: day(daysAgo(Math.floor(random() * 80))),
          ...(categoryId === undefined ? {} : { categoryId }),
          memo: pick([
            'Client visit in Manchester.',
            'Team lunch after the release.',
            'Conference travel.',
            'Replacement charger — mine died.',
            'Taxi from the airport.',
          ]),
        },
      );

      expensesAdded += 1;

      // Most get submitted; a few stay as drafts, because a drafts tab with
      // nothing in it teaches nobody what a draft is.
      if (random() < 0.8) {
        await call(
          person,
          'POST',
          `/expenses/${expense.data.id}/submit`,
          {},
          expense.data.version,
        );
        expensesSubmitted += 1;
      }
    } catch {
      // Policy blocked it, or a validation rule refused. Either is a real
      // outcome and not a reason to stop.
    }
  }

  log(`expenses      +${String(expensesAdded)} (${String(expensesSubmitted)} submitted)`);

  // ── requests to spend, which is what an approver opens the app for ──────

  const PURPOSES: readonly { purpose: string; low: number; high: number }[] = [
    { purpose: 'Conference tickets for the platform team', low: 1200, high: 4800 },
    { purpose: 'Replacement laptops for two new starters', low: 2400, high: 6200 },
    { purpose: 'Annual design tool licences', low: 900, high: 3400 },
    { purpose: 'Client dinner — renewal conversation', low: 180, high: 900 },
    { purpose: 'Recruitment agency fee', low: 3000, high: 9500 },
    { purpose: 'Trade stand at the autumn expo', low: 4000, high: 14000 },
    { purpose: 'Team offsite — venue deposit', low: 1500, high: 5200 },
    { purpose: 'Security audit by an external firm', low: 6000, high: 18000 },
    { purpose: 'Standing desks for the second floor', low: 800, high: 3600 },
    { purpose: 'Translation of the onboarding guide', low: 300, high: 1400 },
  ];

  let requestsAdded = 0;
  let requestsSubmitted = 0;

  for (let index = 0; index < 14; index += 1) {
    const person = pick(claimants);
    const template = pick(PURPOSES);

    try {
      const request = await call<{ data: { id: string; version: number } }>(
        person,
        'POST',
        '/spend-requests',
        {
          spendType: 'SPEND_REQUEST',
          amount: { amount: money(template.low, template.high), currency: 'USD' },
          entityId: entity.id,
          departmentId: pick([...departmentByCode.values()]),
          purpose: template.purpose,
          memo: 'Raised from the demo seed.',
          neededBy: day(daysAgo(-Math.floor(random() * 30) - 3)),
        },
      );

      requestsAdded += 1;

      if (random() < 0.85) {
        await call(
          person,
          'POST',
          `/spend-requests/${request.data.id}/submit`,
          {},
          request.data.version,
        );
        requestsSubmitted += 1;
      }
    } catch {
      // Policy blocked it, which is a real outcome and visible on the screen.
    }
  }

  log(`requests      +${String(requestsAdded)} (${String(requestsSubmitted)} submitted)`);

  // ── decide some of what is waiting, and leave the rest waiting ──────────

  const queue = (
    await call<{ data: { instanceId: string; subjectType: string }[] }>(
      finance,
      'GET',
      '/approvals/queue',
    )
  ).data;

  let decided = 0;

  for (const item of queue) {
    // Two thirds get decided. The remainder is what makes the approvals inbox
    // worth opening.
    if (random() < 0.34) continue;

    try {
      await call(finance, 'POST', `/approvals/${item.instanceId}/act`, {
        action: random() < 0.85 ? 'APPROVE' : 'REJECT',
        comment: random() < 0.4 ? 'Checked against the budget — fine.' : undefined,
      });
      decided += 1;
    } catch {
      // Somebody else got there first, or the chain moved on.
    }
  }

  log(`approvals     ${String(decided)} decided, ${String(queue.length - decided)} left waiting`);

  // ── suppliers and their invoices ────────────────────────────────────────

  let vendorsAdded = 0;
  const vendorIds: string[] = [];

  for (const template of VENDORS) {
    try {
      const vendor = await call<{ data: { id: string } }>(finance, 'POST', '/vendors', {
        name: template.name,
        legalName: `${template.name} Limited`,
        taxId: `GB${String(Math.floor(random() * 900_000_000) + 100_000_000)}`,
        paymentTermsDays: template.terms,
        defaultCurrency: 'USD',
        email: `accounts@${template.name.toLowerCase().replace(/[^a-z]/g, '')}.example`,
        ...(categoryByKey.has(template.category)
          ? { categoryId: categoryByKey.get(template.category) }
          : {}),
      });

      vendorIds.push(vendor.data.id);
      vendorsAdded += 1;
    } catch {
      // Already present.
    }
  }

  if (vendorIds.length === 0) {
    const existing = (
      await call<{ data: { id: string }[] }>(finance, 'GET', '/vendors?pageSize=50')
    ).data;
    vendorIds.push(...existing.map((vendor) => vendor.id));
  }

  log(`vendors       +${String(vendorsAdded)}`);

  let billsAdded = 0;
  let billsPaid = 0;

  for (let index = 0; index < 14; index += 1) {
    if (vendorIds.length === 0) break;

    const issued = daysAgo(Math.floor(random() * 90));

    try {
      const bill = await call<{ data: { id: string; version: number } }>(finance, 'POST', '/bills', {
        vendorId: pick(vendorIds),
        entityId: entity.id,
        billNumber: `INV-${String(2026_000 + index)}-${stamp}`,
        issueDate: day(issued),
        currency: 'USD',
        lines: [
          {
            description: pick([
              'Monthly retainer',
              'Consulting — sprint support',
              'Licence renewal',
              'Office cleaning',
              'Design work',
            ]),
            quantity: '1',
            unitAmount: money(400, 9000),
          },
        ],
      });

      billsAdded += 1;

      const submitted = await call<{ data: { id: string; version: number; status: string } }>(
        finance,
        'POST',
        `/bills/${bill.data.id}/submit`,
        {},
        bill.data.version,
      );

      // Half the approved ones get paid. The rest are the payables list, and
      // the older ones show as overdue — which is the column that screen
      // exists for.
      if (submitted.data.status === 'APPROVED' && random() < 0.5) {
        await call(
          finance,
          'POST',
          `/bills/${bill.data.id}/pay`,
          { paymentReference: `BACS-${stamp}-${String(index)}` },
          submitted.data.version,
        );
        billsPaid += 1;
      }
    } catch {
      // A duplicate number or a policy block. Both are real answers.
    }
  }

  log(`bills         +${String(billsAdded)} (${String(billsPaid)} paid)`);

  // ── purchase orders, one of them half-delivered ─────────────────────────

  let ordersAdded = 0;

  for (let index = 0; index < 5; index += 1) {
    if (vendorIds.length === 0) break;

    try {
      const order = await call<{
        data: { id: string; version: number; lines: { id: string; quantity: string }[] };
      }>(finance, 'POST', '/purchase-orders', {
        vendorId: pick(vendorIds),
        entityId: entity.id,
        currency: 'USD',
        departmentId: pick([...departmentByCode.values()]),
        expectedDate: day(daysAgo(-Math.floor(random() * 40))),
        memo: pick([
          'Laptops for the new starters.',
          'Desks for the second floor.',
          'Monitors — standardising on 27 inch.',
          'Annual licence bundle.',
        ]),
        lines: [
          {
            description: pick(['Laptops', 'Monitors', 'Desks', 'Licences']),
            quantity: String(Math.floor(random() * 12) + 2),
            unitAmount: money(180, 2200),
          },
        ],
      });

      ordersAdded += 1;

      const submitted = await call<{ data: { id: string; version: number; status: string } }>(
        finance,
        'POST',
        `/purchase-orders/${order.data.id}/submit`,
        {},
        order.data.version,
      );

      const line = order.data.lines[0];

      // One in three that is approved gets a partial delivery, so the
      // outstanding column has something in it and the three-way match has
      // something to disagree about.
      if (submitted.data.status === 'APPROVED' && line !== undefined && random() < 0.6) {
        const ordered = Number(line.quantity);
        const arrived = random() < 0.5 ? ordered : Math.max(1, Math.floor(ordered / 2));

        await call(
          finance,
          'POST',
          `/purchase-orders/${order.data.id}/receive`,
          { lines: [{ purchaseOrderLineId: line.id, quantity: String(arrived) }] },
          submitted.data.version,
        );
      }
    } catch {
      // Blocked or already there.
    }
  }

  log(`orders        +${String(ordersAdded)}`);

  // ── a chart of accounts and enough mapping to export something ──────────

  let codesAdded = 0;

  try {
    const chart = await call<{ data: { created: number } }>(
      finance,
      'POST',
      '/accounting/codes/import',
      {
        codeType: 'GL_ACCOUNT',
        codes: [
          { code: '6000', name: 'General expenses' },
          { code: '6100', name: 'Travel and subsistence' },
          { code: '6200', name: 'Software and subscriptions' },
          { code: '6300', name: 'Equipment' },
          { code: '6400', name: 'Marketing' },
          { code: '6500', name: 'Professional fees' },
          { code: '6600', name: 'Office costs' },
        ],
      },
    );

    codesAdded = chart.data.created;

    const glAccounts = (
      await call<{ data: { id: string; code: string }[] }>(
        finance,
        'GET',
        '/accounting/codes?codeType=GL_ACCOUNT&pageSize=100',
      )
    ).data;

    const byCode = new Map(glAccounts.map((row) => [row.code, row.id]));

    const mappings: { name: string; priority: number; category?: string; code: string }[] = [
      { name: 'Travel', priority: 10, category: 'travel', code: '6100' },
      { name: 'Software', priority: 20, category: 'software', code: '6200' },
      { name: 'Equipment', priority: 30, category: 'equipment', code: '6300' },
      { name: 'Marketing', priority: 40, category: 'marketing', code: '6400' },
      { name: 'Professional fees', priority: 50, category: 'professional_services', code: '6500' },
      { name: 'Office', priority: 60, category: 'office', code: '6600' },
      // The catch-all, last. Without one, every record with an unusual
      // category lands in the unmapped queue and the export never completes.
      { name: 'Everything else', priority: 900, code: '6000' },
    ];

    for (const mapping of mappings) {
      const glAccountId = byCode.get(mapping.code);
      if (glAccountId === undefined) continue;

      try {
        await call(finance, 'POST', '/accounting/mappings', {
          name: mapping.name,
          priority: mapping.priority,
          ...(mapping.category !== undefined && categoryByKey.has(mapping.category)
            ? { categoryId: categoryByKey.get(mapping.category) }
            : {}),
          glAccountId,
        });
      } catch {
        // Already there.
      }
    }
  } catch {
    // The chart is already imported.
  }

  log(`gl accounts   +${String(codesAdded)}`);

  log('\nDone. Sign in at http://localhost:3100/login');
  log(`Password for every demo account: ${DEMO_PASSWORD}\n`);
  log('  finance@acme.test   the fullest view — budgets, review queue, bills, exports');
  log('  demo@financy.app    organisation administrator');
  log('  manager@acme.test   department manager, scoped reports');
  log('  employee@acme.test  their own spend only');
  log('  auditor@acme.test   read-only');
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

/**
 * Every word on the public site, in one file.
 *
 * ## Why the copy lives here and not in the pages
 *
 * Fifteen pages share one voice, and a claim made on the pricing page has to
 * agree with the same claim on the plans table and in the FAQ. Keeping the text
 * beside the markup means those three drift, and nobody notices until a
 * customer quotes the wrong one back.
 *
 * ## ⚠️ Placeholder content — replace before this is public
 *
 * The sections marked `PLACEHOLDER` below were carried over from the design
 * mock and are **not true of this product yet**. They are here because the
 * layout needs realistic shapes to be judged, not because the claims hold:
 *
 * - `CUSTOMER_LOGOS`, `CASE_STUDIES`, `PRESS` — invented companies
 * - `AWARDS` — the mock labelled these "Placeholder award" itself
 * - `STATS` — spend volume, receipt counts, close time, uptime
 * - `CERTIFICATIONS` — SOC 2, ISO 27001, PCI DSS
 * - `SERVICES`, `INCIDENTS` — the status page's uptime figures
 *
 * The certifications matter most. Publishing an unearned SOC 2 or PCI DSS
 * claim is a misrepresentation a buyer's procurement team will check and a
 * regulator may act on — it is not the same kind of placeholder as a logo.
 * The rest of the site states things this product genuinely does.
 */

// ── Navigation ─────────────────────────────────────────────────────────────

export const NAV = [
  { label: 'Product', href: '/product' },
  { label: 'Solutions', href: '/solutions' },
  { label: 'Pricing', href: '/pricing' },
  { label: 'Company', href: '/company' },
] as const;

export const FOOTER_COLUMNS = [
  {
    head: 'Product',
    items: [
      { label: 'Cards', href: '/product' },
      { label: 'Expenses', href: '/product' },
      { label: 'Approvals', href: '/product' },
      { label: 'Budgets', href: '/product' },
      { label: 'Pricing', href: '/pricing' },
    ],
  },
  {
    head: 'Solutions',
    items: [
      { label: 'Finance leads', href: '/solutions' },
      { label: 'Controllers', href: '/solutions' },
      { label: 'Managers', href: '/solutions' },
      { label: 'Startups', href: '/solutions' },
    ],
  },
  {
    head: 'Resources',
    items: [
      { label: 'Docs', href: '/docs' },
      { label: 'Writing', href: '/writing' },
      { label: 'Changelog', href: '/changelog' },
      { label: 'Status', href: '/status' },
      { label: 'Security', href: '/security' },
    ],
  },
  {
    head: 'Company',
    items: [
      { label: 'About', href: '/company' },
      { label: 'Customers', href: '/customers' },
      { label: 'Careers', href: '/careers' },
      { label: 'Contact', href: '/contact' },
    ],
  },
] as const;

// ── Home ───────────────────────────────────────────────────────────────────

export const HOME_HEADLINE = 'Company spend, under control by default';

export const HOME_LEAD =
  'Cards, expenses, approvals and budgets on a single ledger. Policy is enforced when the card is used, not discovered at month end.';

/** The product mock in the hero — mirrors the real dashboard's own figures. */
export const APP_NAV = [
  { label: 'Jump to…', badge: '⌘K', active: false },
  { label: 'Overview', badge: '', active: true },
  { label: 'My spend', badge: '', active: false },
  { label: 'Approvals', badge: '5', active: false },
  { label: 'Notifications', badge: '19', active: false },
  { label: 'Cards', badge: '', active: false },
  { label: 'Expenses', badge: '', active: false },
  { label: 'Review', badge: '', active: false },
  { label: 'Budgets', badge: '', active: false },
  { label: 'Reports', badge: '', active: false },
] as const;

export const APP_CARDS = [
  { label: 'Spend this month', value: '$5,134.66', sub: 'vs same point last month' },
  { label: 'Awaiting approval', value: '5', sub: 'Waiting on a person' },
  { label: 'Receipts missing', value: '310', sub: 'Posted charges' },
  { label: 'Owed to staff', value: '$0.00', sub: 'Unpaid batches' },
] as const;

export const APP_BARS = [
  { amount: '42.8K', month: 'Apr', height: 78, partial: false },
  { amount: '38.1K', month: 'May', height: 69, partial: false },
  { amount: '64.9K', month: 'Jun', height: 118, partial: false },
  { amount: '47.1K', month: 'Jul', height: 86, partial: false },
  { amount: '51.9K', month: 'Aug', height: 94, partial: false },
  { amount: '5,135', month: 'Sept · so far', height: 10, partial: true },
] as const;

export const MODULES = [
  {
    num: '01',
    tag: 'Cards',
    title: 'Corporate cards',
    body: 'Virtual cards in seconds, physical in days. Limits by merchant, category and cost centre are enforced at authorisation.',
  },
  {
    num: '02',
    tag: 'Expenses',
    title: 'Receipt capture',
    body: 'Card feed, email forwarding and mobile capture land in one queue. Matching is automatic; only exceptions reach a person.',
  },
  {
    num: '03',
    tag: 'Approvals',
    title: 'Policy routing',
    body: 'Amount, cost centre and vendor decide the path. Approvers act from email or Slack and every decision is stamped.',
  },
  {
    num: '04',
    tag: 'Budgets',
    title: 'Live budgets',
    body: 'Committed against allocated, per team and per project, visible to the owner before the overspend rather than after.',
  },
  {
    num: '05',
    tag: 'Review',
    title: 'Continuous close',
    body: 'Coding, tax and receipt checks run daily, so month end is a review queue instead of a reconstruction.',
  },
  {
    num: '06',
    tag: 'Reports',
    title: 'Ledger export',
    body: 'Reconciled spend by any dimension, pushed into Xero, NetSuite or Tally on the schedule you set.',
  },
] as const;

/** PLACEHOLDER — none of these figures are measured. */
export const STATS = [
  { k: '$1.4B', v: 'annualised spend managed' },
  { k: '310K', v: 'receipts matched each month' },
  { k: '4 days', v: 'average close, down from 11' },
  { k: '99.99%', v: 'platform uptime' },
] as const;

/** PLACEHOLDER — invented companies. */
export const CUSTOMER_LOGOS = [
  'Northwind',
  'Ledgerly',
  'Cartsmith',
  'Paperbase',
  'Volta',
  'Signalbox',
] as const;

/** PLACEHOLDER — the mock labelled these "Placeholder award". */
export const AWARDS = [
  { year: '2025', title: 'Fintech of the Year', meta: 'Placeholder award' },
  { year: '2025', title: 'Best Spend Platform', meta: 'Placeholder award' },
  { year: '2024', title: 'High Growth 100', meta: 'Placeholder listing' },
  { year: '2024', title: "Editors' Choice", meta: 'Placeholder award' },
] as const;

/** PLACEHOLDER — invented publications. */
export const PRESS = [
  'The Ledger',
  'FinTech Weekly',
  'CFO Review',
  'Business Standard',
  'Tech in Asia',
] as const;

// ── Product ────────────────────────────────────────────────────────────────

export const FEATURES = [
  {
    num: '01',
    tag: 'Cards',
    title: 'Issue and control',
    body: 'Virtual cards in seconds, physical cards in days. Limits by merchant, category, cadence and cost centre are enforced at authorisation rather than flagged in a report a month later.',
    points: ['Per-merchant locks', 'Auto-expiring cards', 'Instant freeze'],
  },
  {
    num: '02',
    tag: 'Expenses',
    title: 'Capture and match',
    body: 'The card feed, email forwarding and mobile capture all land in the same queue. Line items match to charges on their own and only genuine exceptions reach a human.',
    points: ['OCR line items', 'Auto-nudges', 'Mileage and per diem'],
  },
  {
    num: '03',
    tag: 'Approvals',
    title: 'Route by policy',
    body: 'Thresholds, cost centres and vendor rules decide who signs off. Approvers act from email or Slack, and each decision is written into the audit trail with its context.',
    points: ['Multi-step chains', 'Delegation', 'Full audit trail'],
  },
  {
    num: '04',
    tag: 'Budgets',
    title: 'Plan and hold',
    body: 'Allocate by team, project or campaign. Owners see committed and spent side by side, and card limits can tighten automatically as a budget runs down.',
    points: ['Rolling periods', 'Owner alerts', 'Hard and soft caps'],
  },
  {
    num: '05',
    tag: 'Review',
    title: 'Close continuously',
    body: 'Coding, tax treatment and missing-receipt checks run every day, so close readiness is a live number rather than the last week of the month.',
    points: ['Daily checks', 'Exception queue', 'Lock periods'],
  },
  {
    num: '06',
    tag: 'Reports',
    title: 'Export clean',
    body: 'Spend by team, vendor, category or entity, already reconciled and coded, pushed into your ledger or delivered as a flat file on a schedule.',
    points: ['Xero and NetSuite', 'Tally and CSV', 'Scheduled delivery'],
  },
] as const;

// ── Solutions ──────────────────────────────────────────────────────────────

export const SOLUTIONS = [
  {
    num: '01',
    title: 'Finance leads',
    body: 'A close you can forecast, and controls that hold without you reviewing every line personally.',
  },
  {
    num: '02',
    title: 'Controllers',
    body: 'Coding, tax and receipt gaps surfaced daily instead of discovered in the last week of the month.',
  },
  {
    num: '03',
    title: 'Team managers',
    body: 'A live view of your own budget, and approvals that take one tap from the inbox.',
  },
  {
    num: '04',
    title: 'Employees',
    body: 'Pay with a card that already knows the policy. Photograph the receipt once and you are done.',
  },
  {
    num: '05',
    title: 'Startups',
    body: 'Set up in a day, with limits and approvals that scale past the point a spreadsheet stops working.',
  },
  {
    num: '06',
    title: 'Multi-entity groups',
    body: 'Separate ledgers, shared policy, and one consolidated view across every entity and currency.',
  },
] as const;

// ── Pricing ────────────────────────────────────────────────────────────────

export const PLANS = [
  {
    name: 'Starter',
    price: 'Free',
    unit: 'up to 10 users',
    body: 'Cards, receipt capture and single-step approvals for a team that has outgrown the shared credit card.',
    cta: 'Start free',
    href: '/register',
    primary: false,
    items: [
      'Unlimited virtual cards',
      'Receipt capture and matching',
      'Single-step approvals',
      'CSV export',
    ],
  },
  {
    name: 'Growth',
    price: '$8',
    unit: 'per user / month',
    body: 'Policy routing, budgets and continuous close for finance teams running spend across several departments.',
    cta: 'Book a demo',
    href: '/contact',
    primary: true,
    items: [
      'Everything in Starter',
      'Multi-step policy routing',
      'Budgets with hard caps',
      'Xero, NetSuite and Tally sync',
      'Daily close checks',
    ],
  },
  {
    name: 'Enterprise',
    price: 'Custom',
    unit: 'annual agreement',
    body: 'Multi-entity consolidation, SSO and a named contact for groups closing books across currencies.',
    cta: 'Contact sales',
    href: '/contact',
    primary: false,
    items: [
      'Everything in Growth',
      'Multi-entity and multi-currency',
      'SAML SSO and SCIM',
      'Custom approval logic',
      'Named success contact',
    ],
  },
] as const;

export const PLAN_COMPARISON = [
  { k: 'Virtual and physical cards', a: 'Unlimited', b: 'Unlimited', c: 'Unlimited' },
  { k: 'Approval steps', a: '1', b: 'Up to 5', c: 'Custom' },
  { k: 'Budgets', a: '—', b: 'Team and project', c: 'Entity, team, project' },
  { k: 'Ledger sync', a: 'CSV', b: 'Xero, NetSuite, Tally', c: 'Any, plus API' },
  { k: 'Entities', a: '1', b: '3', c: 'Unlimited' },
  { k: 'SSO and SCIM', a: '—', b: 'SSO', c: 'SSO and SCIM' },
  { k: 'Support', a: 'Email', b: 'Priority email', c: 'Named contact' },
] as const;

export const FAQS = [
  {
    q: 'Is there a card interchange share?',
    a: 'Yes. Interchange earned on your spend is rebated monthly against the subscription on Growth and Enterprise.',
  },
  {
    q: 'How long does implementation take?',
    a: 'Most teams are issuing cards on day one. A full policy and ledger setup typically takes two weeks.',
  },
  {
    q: 'Which ledgers do you support?',
    a: 'Xero, NetSuite, Tally and QuickBooks natively; anything else through the API or a scheduled flat file.',
  },
  {
    q: 'Can we start on one entity?',
    a: 'Yes. Entities are added later without re-onboarding, and history is preserved.',
  },
] as const;

// ── Company ────────────────────────────────────────────────────────────────

export const TIMELINE = [
  { year: '2021', body: 'Started as an internal tool for a finance team closing eleven-day months.' },
  { year: '2023', body: 'Cards and approvals launched together; first hundred customers onboarded.' },
  { year: '2024', body: 'Continuous close shipped, cutting the average close to four days.' },
  { year: '2026', body: 'Multi-entity consolidation and a team of forty across two offices.' },
] as const;

export const VALUES = [
  {
    num: '01',
    title: 'Controls before dashboards',
    body: 'A limit that holds is worth more than a chart explaining what already went wrong.',
  },
  {
    num: '02',
    title: 'Finance is the customer',
    body: 'Employees should barely notice the process. The people who own the number should feel it working.',
  },
  {
    num: '03',
    title: 'One ledger, no exports',
    body: 'Every feature we add has to sit on the same record, or it becomes another reconciliation.',
  },
] as const;

// ── Careers ────────────────────────────────────────────────────────────────

export const ROLES = [
  { title: 'Senior Backend Engineer', team: 'Platform', loc: 'Bengaluru / Hybrid', type: 'Full-time' },
  { title: 'Product Designer', team: 'Product', loc: 'Bengaluru / Hybrid', type: 'Full-time' },
  { title: 'Implementation Manager', team: 'Customer', loc: 'Mumbai', type: 'Full-time' },
  { title: 'Compliance Analyst', team: 'Risk', loc: 'Remote, India', type: 'Full-time' },
  { title: 'Account Executive', team: 'Sales', loc: 'Bengaluru', type: 'Full-time' },
] as const;

export const PERKS = [
  {
    title: 'Own the surface',
    body: 'Small teams with end-to-end ownership of a module, from policy design to release.',
  },
  {
    title: 'Real customers, early',
    body: 'Everyone speaks to finance teams. Feature calls come from those conversations, not a roadmap deck.',
  },
  {
    title: 'Paid for depth',
    body: 'Above-market cash, meaningful equity, and time budgeted for the unglamorous reliability work.',
  },
] as const;

// ── Security ───────────────────────────────────────────────────────────────

/** PLACEHOLDER — none of these certifications have been obtained. */
export const CERTIFICATIONS = [
  { k: 'SOC 2 Type II', v: 'Audited annually, report on request' },
  { k: 'ISO 27001', v: 'Certified information security management' },
  { k: 'PCI DSS Level 1', v: 'Card data handled by our issuing partner' },
  { k: 'DPDP Act', v: 'Indian data residency available' },
] as const;

export const SECURITY_PRACTICES = [
  {
    num: '01',
    title: 'Encryption everywhere',
    body: 'TLS 1.3 in transit, AES-256 at rest, and card credentials tokenised so they never touch our systems.',
  },
  {
    num: '02',
    title: 'Least privilege',
    body: 'SSO, SCIM provisioning and role-based access down to the cost centre, with every admin action logged.',
  },
  {
    num: '03',
    title: 'Tested continuously',
    body: 'Annual third-party penetration tests, continuous dependency scanning, and a public disclosure programme.',
  },
  {
    num: '04',
    title: 'Recoverable by design',
    body: 'Point-in-time recovery, multi-region backups, and a documented RTO of four hours tested twice a year.',
  },
] as const;

// ── Customers ──────────────────────────────────────────────────────────────

/** PLACEHOLDER — invented companies and metrics. */
export const CASE_STUDIES = [
  {
    num: '01',
    co: 'Northwind',
    industry: 'Logistics',
    metric: '11 → 4 days',
    body: 'Six hundred drivers on fuel cards with per-merchant locks, and a close that no longer waits on paper receipts.',
  },
  {
    num: '02',
    co: 'Ledgerly',
    industry: 'Professional services',
    metric: '94% receipts matched',
    body: 'Client-billable spend coded at the point of purchase, so re-billing runs the same week rather than the next month.',
  },
  {
    num: '03',
    co: 'Cartsmith',
    industry: 'Ecommerce',
    metric: '$0 unapproved spend',
    body: 'Ad platform cards with hard monthly caps, replacing a shared card that three teams had the number for.',
  },
  {
    num: '04',
    co: 'Paperbase',
    industry: 'SaaS',
    metric: '5 entities, 1 view',
    body: 'Consolidated spend across five entities and three currencies, with local approval rules kept intact.',
  },
  {
    num: '05',
    co: 'Volta',
    industry: 'Manufacturing',
    metric: '2 weeks to rollout',
    body: 'Four hundred employees onboarded in a fortnight, with policy imported from the existing expense manual.',
  },
  {
    num: '06',
    co: 'Signalbox',
    industry: 'Media',
    metric: '38% fewer approvals',
    body: 'Threshold rules cleared routine spend automatically, leaving managers only the exceptions to look at.',
  },
] as const;

// ── Writing ────────────────────────────────────────────────────────────────

export const POSTS = [
  {
    kind: 'Guide',
    date: 'Aug 2026',
    title: 'What a four-day close actually requires',
    body: 'The three checks that have to move from month end to every day, and the order to move them in.',
  },
  {
    kind: 'Report',
    date: 'Jul 2026',
    title: 'Spend controls benchmark, India 2026',
    body: 'Survey of 240 finance teams on card policy, approval depth and time to close.',
  },
  {
    kind: 'Note',
    date: 'Jun 2026',
    title: 'Why receipt chasing is a policy problem',
    body: 'Missing receipts are usually a limits failure upstream, not a discipline failure downstream.',
  },
  {
    kind: 'Guide',
    date: 'May 2026',
    title: 'Setting card limits that people do not route around',
    body: 'A practical framework for merchant, category and cadence caps by team.',
  },
  {
    kind: 'Note',
    date: 'Apr 2026',
    title: 'Multi-entity spend without a consolidation spreadsheet',
    body: 'Keeping local approval rules while reporting one consolidated number.',
  },
] as const;

// ── Docs ───────────────────────────────────────────────────────────────────

export const API_SAMPLE = [
  'curl -X POST https://api.financy.app/v1/cards \\',
  '  -H "Authorization: Bearer $FINANCY_KEY" \\',
  '  -d \'{"holder":"grace@acme.com","limit":250000,',
  '      "cadence":"monthly","cost_centre":"marketing"}\'',
] as const;

export const DOC_SECTIONS = [
  {
    num: '01',
    title: 'Quickstart',
    body: 'Authenticate, create your first virtual card and post a test charge in under ten minutes.',
    links: ['Authentication', 'Sandbox keys', 'First card'],
  },
  {
    num: '02',
    title: 'Cards API',
    body: 'Create, freeze, and set limits on virtual and physical cards, including cadence and merchant rules.',
    links: ['Create card', 'Set limits', 'Freeze and close'],
  },
  {
    num: '03',
    title: 'Transactions',
    body: 'Read authorisations and settlements, attach receipts, and subscribe to charge webhooks.',
    links: ['List charges', 'Attach receipt', 'Webhooks'],
  },
  {
    num: '04',
    title: 'Approvals',
    body: 'Define policy chains, submit decisions programmatically, and read the audit trail.',
    links: ['Policy objects', 'Decisions', 'Audit log'],
  },
  {
    num: '05',
    title: 'Ledger sync',
    body: 'Map cost centres and tax codes, then push reconciled spend to your accounting system.',
    links: ['Chart of accounts', 'Sync schedule', 'Error handling'],
  },
] as const;

// ── Changelog ──────────────────────────────────────────────────────────────

export const RELEASES = [
  {
    date: '28 Aug 2026',
    tag: 'Added',
    title: 'Cadence limits on virtual cards',
    body: 'Weekly and quarterly caps alongside the existing monthly limit, enforced at authorisation.',
  },
  {
    date: '14 Aug 2026',
    tag: 'Added',
    title: 'Tally sync',
    body: 'Reconciled spend now pushes to Tally on the same schedule as Xero and NetSuite.',
  },
  {
    date: '31 Jul 2026',
    tag: 'Improved',
    title: 'Faster receipt matching',
    body: 'Line-item OCR now resolves in under two seconds for the common formats, down from nine.',
  },
  {
    date: '18 Jul 2026',
    tag: 'Fixed',
    title: 'Duplicate approval notifications',
    body: 'Delegated approvers no longer receive a second notification when the primary approver acts first.',
  },
  {
    date: '02 Jul 2026',
    tag: 'Added',
    title: 'Entity-level budgets',
    body: 'Budgets can now be allocated at entity level and rolled up into a consolidated view.',
  },
] as const;

// ── Status ─────────────────────────────────────────────────────────────────

/** PLACEHOLDER — not measured against a real monitor. */
export const SERVICES = [
  { k: 'Card authorisation', v: 'Operational', up: '99.998%' },
  { k: 'Dashboard', v: 'Operational', up: '99.99%' },
  { k: 'Public API', v: 'Operational', up: '99.99%' },
  { k: 'Receipt processing', v: 'Operational', up: '99.96%' },
  { k: 'Ledger sync', v: 'Operational', up: '99.97%' },
  { k: 'Notifications', v: 'Operational', up: '99.99%' },
] as const;

/** PLACEHOLDER — invented incidents. */
export const INCIDENTS = [
  {
    date: '12 Aug 2026',
    title: 'Delayed receipt processing',
    body: 'Queue backlog of 40 minutes affecting OCR matching. Card authorisation was unaffected. Resolved in 1h 20m.',
  },
  {
    date: '03 Jun 2026',
    title: 'Xero sync failures',
    body: 'A partner API change caused sync errors for 6% of accounts. Retried automatically after the fix. Resolved in 3h 05m.',
  },
] as const;

// ── Contact ────────────────────────────────────────────────────────────────

export const CONTACT_ROWS = [
  { k: 'Sales', v: 'sales@financy.app' },
  { k: 'Support', v: 'help@financy.app' },
  { k: 'Hours', v: 'Mon–Fri, 9:00–18:00 IST' },
] as const;

export const CONTACT_FIELDS = [
  { label: 'Full name', placeholder: 'Grace Sharma', type: 'text', autoComplete: 'name' },
  { label: 'Work email', placeholder: 'grace@company.com', type: 'email', autoComplete: 'email' },
  { label: 'Company', placeholder: 'Acme Ltd', type: 'text', autoComplete: 'organization' },
  { label: 'Team size', placeholder: '50–200', type: 'text', autoComplete: 'off' },
] as const;

// ── Legal ──────────────────────────────────────────────────────────────────

export const LEGAL_UPDATED = 'Last updated 1 August 2026';

export const PRIVACY_SECTIONS = [
  {
    num: '01',
    title: 'What we collect',
    body: 'Account details, transaction records from your card programme, receipts you upload, and product usage logs. We do not collect card credentials; those sit with our issuing partner in tokenised form.',
  },
  {
    num: '02',
    title: 'Why we hold it',
    body: 'To operate the card programme, enforce your own policy rules, meet statutory record-keeping under Indian financial regulation, and support you when something goes wrong.',
  },
  {
    num: '03',
    title: 'Who sees it',
    body: 'Your administrators, our support staff on a least-privilege basis, our issuing and processing partners, and regulators where the law requires it. We do not sell data or use it to train external models.',
  },
  {
    num: '04',
    title: 'How long we keep it',
    body: 'Transaction and receipt records for eight years as required for audit; product logs for thirteen months; account data until ninety days after termination.',
  },
  {
    num: '05',
    title: 'Your rights',
    body: 'Access, correction, export and erasure requests under the DPDP Act can be raised at privacy@financy.app and are answered within thirty days.',
  },
] as const;

export const TERMS_SECTIONS = [
  {
    num: '01',
    title: 'The agreement',
    body: 'These terms cover use of the dashboard, the API and the card programme. Enterprise customers may have a signed agreement that takes precedence over anything written here.',
  },
  {
    num: '02',
    title: 'Your responsibilities',
    body: 'Keeping administrator access controlled, ensuring spend complies with your own policy and applicable law, and settling invoices within the agreed term.',
  },
  {
    num: '03',
    title: 'Cards and funds',
    body: 'Cards are issued by our regulated banking partner. Funds held in your account are settlement balances, are not deposits, and do not earn interest.',
  },
  {
    num: '04',
    title: 'Fees',
    body: "Subscription is charged monthly per active user. Interchange rebates are credited against the following month's invoice. Taxes are additional.",
  },
  {
    num: '05',
    title: 'Availability and liability',
    body: 'We target 99.9% monthly availability for the dashboard and API. Liability is capped at fees paid in the preceding twelve months, except where the law does not permit it.',
  },
  {
    num: '06',
    title: 'Ending it',
    body: "Either party may terminate with thirty days' notice. Cards are frozen at termination and export of your records remains available for ninety days.",
  },
] as const;

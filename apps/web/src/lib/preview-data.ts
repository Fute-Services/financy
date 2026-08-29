/**
 * PREVIEW DATA — NOT A DATA LAYER.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  Every value in this file is invented. Nothing here comes from a database,
 *  an API, or a provider. It exists for exactly one reason: so the interface
 *  can be designed, reviewed, and navigated before the backend exists.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Rules that keep this honest, and keep it from quietly becoming the app:
 *
 *  1. It is imported **only** by pages that render the preview banner, so a
 *     figure from this file can never appear on screen without the viewer
 *     being told it is not real.
 *  2. It is deleted in Phase 4 when `GET /v1/dashboard/*` lands. It is not
 *     "temporarily" kept as a fallback — a fallback that silently substitutes
 *     invented figures for a failed request is precisely the failure mode
 *     docs/01 §7 principle 9 exists to prevent.
 *  3. Amounts are strings with an explicit currency, exactly as the API will
 *     send them, so the components are exercised against the real shape.
 *
 * See docs/13-INTEGRATIONS.md §12 and ADR-0014 for why labelling matters here.
 */

export const PREVIEW_CURRENCY = 'USD';

export interface PreviewKpi {
  label: string;
  amount?: string;
  count?: string;
  delta?: string;
  direction: 'up' | 'down' | 'flat';
  /** Whether an increase is a good outcome. Spend rising is not. */
  goodWhenUp: boolean;
  hint: string;
}

export const PREVIEW_KPIS: PreviewKpi[] = [
  {
    label: 'Spend this month',
    amount: '184320.5000',
    delta: '12.4%',
    direction: 'up',
    goodWhenUp: false,
    hint: 'vs. last month',
  },
  {
    label: 'Pending approvals',
    count: '14',
    delta: '3',
    direction: 'up',
    goodWhenUp: false,
    hint: 'oldest 2 days',
  },
  {
    label: 'Missing receipts',
    count: '27',
    delta: '9',
    direction: 'down',
    goodWhenUp: false,
    hint: 'vs. last week',
  },
  {
    label: 'Uncategorised',
    count: '6',
    delta: '4',
    direction: 'down',
    goodWhenUp: false,
    hint: 'blocking close',
  },
];

export interface PreviewRequest {
  id: string;
  reference: string;
  requester: string;
  department: string;
  category: string;
  amount: string;
  status: string;
  policy: string;
  age: string;
}

export const PREVIEW_REQUESTS: PreviewRequest[] = [
  {
    id: '1',
    reference: 'SR-2026-0142',
    requester: 'Aisha Rahman',
    department: 'Engineering',
    category: 'Software',
    amount: '2400.0000',
    status: 'PENDING_APPROVAL',
    policy: 'Manager + Finance',
    age: '2h',
  },
  {
    id: '2',
    reference: 'SR-2026-0141',
    requester: 'Tom Okafor',
    department: 'Marketing',
    category: 'Advertising',
    amount: '15000.0000',
    status: 'PENDING_APPROVAL',
    policy: 'Manager + Finance',
    age: '6h',
  },
  {
    id: '3',
    reference: 'SR-2026-0140',
    requester: 'Lena Fischer',
    department: 'Engineering',
    category: 'Hardware',
    amount: '1850.0000',
    status: 'APPROVED',
    policy: 'Manager',
    age: '1d',
  },
  {
    id: '4',
    reference: 'SR-2026-0139',
    requester: 'Sam Whitfield',
    department: 'Sales',
    category: 'Travel',
    amount: '840.5000',
    status: 'CHANGES_REQUESTED',
    policy: 'Manager',
    age: '1d',
  },
  {
    id: '5',
    reference: 'SR-2026-0138',
    requester: 'Priya Nair',
    department: 'Operations',
    category: 'Software',
    amount: '320.0000',
    status: 'BLOCKED',
    policy: 'Receipt required',
    age: '2d',
  },
  {
    id: '6',
    reference: 'SR-2026-0137',
    requester: 'Marcus Bell',
    department: 'Engineering',
    category: 'Services',
    amount: '9600.0000',
    status: 'REJECTED',
    policy: 'Manager + Finance',
    age: '3d',
  },
];

export interface PreviewBudget {
  id: string;
  name: string;
  scope: string;
  allocated: string;
  spent: string;
  remaining: string;
  /** Server-computed in the real system. Never derived in the browser. */
  utilization: number;
}

export const PREVIEW_BUDGETS: PreviewBudget[] = [
  {
    id: '1',
    name: 'Engineering — Q3',
    scope: 'Department',
    allocated: '120000.0000',
    spent: '78400.0000',
    remaining: '41600.0000',
    utilization: 65.3,
  },
  {
    id: '2',
    name: 'Marketing — Q3',
    scope: 'Department',
    allocated: '90000.0000',
    spent: '74700.0000',
    remaining: '15300.0000',
    utilization: 83,
  },
  {
    id: '3',
    name: 'Sales travel — Q3',
    scope: 'Category',
    allocated: '45000.0000',
    spent: '43200.0000',
    remaining: '1800.0000',
    utilization: 96,
  },
  {
    id: '4',
    name: 'Operations — Q3',
    scope: 'Department',
    allocated: '30000.0000',
    spent: '31450.0000',
    remaining: '-1450.0000',
    utilization: 104.8,
  },
];

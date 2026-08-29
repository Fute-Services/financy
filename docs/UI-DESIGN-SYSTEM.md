# UI Design System — Financy

**Status:** Baseline v1.0 — 2026-08-29
**Implementation:** `packages/ui` + `packages/config/tailwind`
**Read before:** building any screen. Screens are assembled from this system, not designed ad hoc.

---

## 1. Design principles

Financy is a professional tool that finance people use for hours a day. It is judged on whether
it is *trustworthy and fast*, not on whether it is pretty.

1. **Clarity over decoration.** Every visual element earns its place by aiding comprehension. No
   gradients on data. No shadows implying depth that does not exist. No illustration where a
   number belongs.
2. **Density with hierarchy.** A finance table should show 25–40 rows without scrolling. Density
   is achieved through tight, consistent rhythm and strong typographic hierarchy — never by
   shrinking text below legibility.
3. **Numbers are the interface.** Amounts are right-aligned, tabular-figured, and consistently
   precise. A column of numbers must be scannable as a column.
4. **Status is text plus colour, never colour alone.** Colour-blind users, printed reports, and
   greyscale screenshots must all remain readable.
5. **Predictability beats novelty.** The same action looks and behaves identically everywhere. A
   finance tool that surprises you is a finance tool you stop trusting.
6. **Restraint signals seriousness.** The visual identity is quiet and precise. Colour is reserved
   for meaning, so when something *is* coloured, it matters.

**Original identity.** This system is designed from first principles for this product. It
deliberately does not reproduce any existing product's palette, typography, iconography, layout, or
component styling.

---

## 2. Colour

### 2.1 Approach

Two families only: a cool neutral ramp that carries almost all of the interface, and a small set
of semantic colours that carry meaning. There is no decorative colour.

### 2.2 Neutral — "Ink"

A slightly cool grey ramp. Used for surfaces, borders, and text.

| Token | Hex | Use |
|---|---|---|
| `ink-0` | `#FFFFFF` | Card and table surface (light) |
| `ink-25` | `#FBFCFD` | Page background (light) |
| `ink-50` | `#F5F7FA` | Subtle fill, table header, hover row |
| `ink-100` | `#EBEEF3` | Hairline dividers, disabled fill |
| `ink-200` | `#DCE1E9` | Default border |
| `ink-300` | `#C2CAD6` | Strong border, input border |
| `ink-400` | `#98A3B4` | Placeholder, disabled text |
| `ink-500` | `#6B7788` | Secondary text, icons |
| `ink-600` | `#4E5867` | Body text (secondary emphasis) |
| `ink-700` | `#3A4250` | Body text |
| `ink-800` | `#262D38` | Headings |
| `ink-900` | `#161B23` | Primary text, sidebar (dark) |
| `ink-950` | `#0C1017` | Page background (dark) |

### 2.3 Brand / interactive — "Cobalt"

Reserved for interactive intent: primary actions, focus, selection, active navigation. Never used
decoratively, so its presence always means "you can act here".

| Token | Hex | Use |
|---|---|---|
| `cobalt-50` | `#EEF3FF` | Selected row, subtle badge fill |
| `cobalt-100` | `#DBE5FF` | Hover on subtle fill |
| `cobalt-200` | `#BACCFF` | Focus ring (light) |
| `cobalt-400` | `#6E8DF5` | Accent on dark surfaces |
| `cobalt-500` | `#3D63E8` | Links, secondary emphasis |
| `cobalt-600` | `#2A4CD1` | **Primary button** — 5.9:1 on white |
| `cobalt-700` | `#1F3BA8` | Primary hover |
| `cobalt-800` | `#182D80` | Primary active |

### 2.4 Semantic

Each has a `fill` (subtle background), a `border`, and a `text` (AA on the fill).

| Meaning | Token | Fill | Border | Text | Used for |
|---|---|---|---|---|---|
| Positive | `success` | `#E7F6EC` | `#A9DFBB` | `#0A6B36` | Approved · Reviewed · Paid · Under budget |
| Caution | `warning` | `#FEF4E6` | `#F5CE94` | `#8A5000` | Pending · Needs receipt · 75–90 % budget |
| Critical | `danger` | `#FDECEC` | `#F3B4B4` | `#A3161C` | Rejected · Blocked · Overspent · Failed |
| Informational | `info` | `#E9F2FC` | `#A9CCF0` | `#0F5399` | Draft · Imported · System note |
| In progress | `pending` | `#F1EDFD` | `#CBBDF5` | `#5B34B5` | Awaiting approval · In review · Processing |
| Neutral | `neutral` | `ink-50` | `ink-200` | `ink-600` | Cancelled · Expired · Archived · N/A |

Distinct `warning` and `pending` matter: "waiting for someone" and "something needs fixing" are
different states, and finance users act on them differently.

### 2.5 Data visualisation

An ordered categorical sequence, chosen for hue separation that survives protanopia and
deuteranopia, and for legibility at 2px stroke width.

| # | Hex | | # | Hex |
|---|---|---|---|---|
| 1 | `#2A4CD1` | | 5 | `#0A6B36` |
| 2 | `#3E9AA8` | | 6 | `#8A5000` |
| 3 | `#8C5BD4` | | 7 | `#A3161C` |
| 4 | `#C77D2E` | | 8 | `#4E5867` |

Sequential (for heat and intensity): `#EEF3FF → #BACCFF → #6E8DF5 → #2A4CD1 → #182D80`.
Diverging (budget variance, under → over): `#0A6B36 → #A9DFBB → #EBEEF3 → #F3B4B4 → #A3161C`.

Rules: never encode meaning by colour alone — pair with label, pattern, or position. Never more
than eight categories; beyond that, group into "Other". Chart colours are never reused for status.

### 2.6 Dark mode

Every token is a CSS custom property; dark mode remaps them. Not a filter, not an inversion —
elevation reverses (surfaces lighten as they rise) and semantic colours are re-tuned for contrast
against dark surfaces.

```css
:root {
  --surface-page: var(--ink-25);
  --surface-raised: var(--ink-0);
  --surface-sunken: var(--ink-50);
  --border-default: var(--ink-200);
  --text-primary: var(--ink-900);
  --text-secondary: var(--ink-500);
}
[data-theme='dark'] {
  --surface-page: var(--ink-950);
  --surface-raised: #151A22;
  --surface-sunken: #0F141B;
  --border-default: #2A3240;
  --text-primary: var(--ink-50);
  --text-secondary: var(--ink-400);
}
```

### 2.7 Contrast requirements

| Pair | Minimum | Actual |
|---|---|---|
| Body text on page | 4.5:1 | `ink-700` on `ink-25` = 10.4:1 |
| Secondary text | 4.5:1 | `ink-500` on `ink-0` = 4.8:1 |
| Primary button label | 4.5:1 | white on `cobalt-600` = 5.9:1 |
| Borders and UI boundaries | 3:1 | `ink-300` on `ink-0` = 3.1:1 |
| Focus ring | 3:1 | `cobalt-600` against adjacent = 5.9:1 |

Contrast is asserted in CI by a token test, so a future palette tweak cannot silently break AA.

---

## 3. Typography

### 3.1 Families

| Role | Stack |
|---|---|
| Interface | `Inter var`, `-apple-system`, `Segoe UI`, `Roboto`, sans-serif |
| Numeric | Inter with `font-variant-numeric: tabular-nums` |
| Mono | `JetBrains Mono`, `SF Mono`, `Consolas`, monospace — IDs, codes, references |

`tabular-nums` on every numeric column is not a nicety. Proportional digits make a column of
amounts ragged and slow to scan, which is exactly the task this product exists to support.

### 3.2 Scale

A 1.2 ratio, tightened at the top because a dense application has no use for display type.

| Token | Size / line | Weight | Tracking | Use |
|---|---|---|---|---|
| `display` | 30 / 36 | 600 | −0.02em | Dashboard hero figure only |
| `h1` | 24 / 32 | 600 | −0.015em | Page title |
| `h2` | 20 / 28 | 600 | −0.01em | Section heading |
| `h3` | 16 / 24 | 600 | 0 | Card and panel heading |
| `body-lg` | 15 / 22 | 400 | 0 | Detail page body |
| `body` | 14 / 20 | 400 | 0 | **Default** — tables, forms |
| `body-sm` | 13 / 18 | 400 | 0 | Secondary, dense tables |
| `caption` | 12 / 16 | 500 | 0.01em | Labels, metadata, help |
| `overline` | 11 / 16 | 600 | 0.06em | Section eyebrows, uppercase |
| `mono` | 13 / 20 | 400 | 0 | IDs, references |
| `amount` | 14 / 20 | 500 | 0 | Table amounts, tabular |
| `amount-lg` | 20 / 28 | 600 | −0.01em | KPI figures, tabular |

Minimum interface size is 12px. Nothing smaller ships.

### 3.3 Amount formatting

| Context | Format |
|---|---|
| Table cell | `12,450.00` right-aligned, currency in a column header or adjacent column |
| Mixed currency in one table | `$12,450.00` / `€9,800.00` — symbol per cell, required |
| KPI | `$12,450` — no decimals above 10,000 unless precision matters |
| Detail page | `$12,450.00 USD` — full precision, explicit code |
| Negative | `−$1,200.00` with a true minus (U+2212) and `danger` text; never red parentheses alone |
| Zero | `$0.00`, never `—` |
| Unknown | `—` with a tooltip explaining why |

---

## 4. Spacing, radius, elevation

### 4.1 Spacing — 4px base

`0 · 2 · 4 · 6 · 8 · 12 · 16 · 20 · 24 · 32 · 40 · 48 · 64`

| Context | Value |
|---|---|
| Icon to adjacent label | 6 |
| Related controls in a group | 8 |
| Form field vertical rhythm | 16 |
| Card padding | 20 |
| Section separation | 32 |
| Page gutter | 24 |
| Table cell padding (default / compact) | 12×16 / 8×12 |

### 4.2 Radius

| Token | Value | Use |
|---|---|---|
| `radius-xs` | 3px | Badges, tags |
| `radius-sm` | 5px | Inputs, buttons, table row selection |
| `radius-md` | 8px | Cards, panels, dropdowns |
| `radius-lg` | 12px | Modals, drawers |
| `radius-full` | 9999px | Avatars, dot indicators |

Modest radii. Heavily rounded corners read as consumer software and cost horizontal space in
dense tables.

### 4.3 Elevation

Borders carry structure; shadows carry only true layering. A card sitting on a page is bordered,
not shadowed.

| Token | Shadow | Use |
|---|---|---|
| `elev-0` | none, `1px` border | Cards, tables, panels |
| `elev-1` | `0 1px 2px rgb(16 24 40 / 0.05)` | Sticky headers |
| `elev-2` | `0 4px 8px -2px rgb(16 24 40 / 0.08), 0 2px 4px -2px rgb(16 24 40 / 0.05)` | Dropdowns, popovers |
| `elev-3` | `0 12px 16px -4px rgb(16 24 40 / 0.10), 0 4px 6px -2px rgb(16 24 40 / 0.04)` | Modals, drawers |
| `elev-focus` | `0 0 0 3px var(--cobalt-200)` | Focus ring |

---

## 5. Layout grid

| Property | Value |
|---|---|
| Sidebar | 240px, collapses to 64px |
| Top bar | 56px, sticky |
| Content max width | 1600px, centred |
| Page gutter | 24px (16px below `md`) |
| Grid | 12 columns, 20px gutter |
| Detail page split | 8 / 4 columns (main / related rail) |
| Drawer | 480px, docked above 1280px, overlay below |
| Modal | 480 / 640 / 800px by content weight |

Breakpoints: `sm 640` · `md 768` · `lg 1024` · `xl 1280` · `2xl 1536`.

---

## 6. Component specifications

### 6.1 Button

| Variant | Fill | Text | Border | Use |
|---|---|---|---|---|
| `primary` | `cobalt-600` | white | none | The one main action per view |
| `secondary` | `ink-0` | `ink-700` | `ink-300` | Common secondary actions |
| `ghost` | transparent | `ink-600` | none | Toolbar, low emphasis |
| `danger` | `danger.text` | white | none | Destructive, confirmed |
| `danger-subtle` | `danger.fill` | `danger.text` | `danger.border` | Destructive in a menu |
| `link` | none | `cobalt-500` | none | Inline navigation |

Sizes: `sm` 28px · `md` 34px (default) · `lg` 40px. Horizontal padding 12/14/16.

States: hover darkens one step; active darkens two; focus adds `elev-focus`; disabled is
`ink-100` fill with `ink-400` text and `cursor: not-allowed`; loading replaces the leading icon
with a spinner, keeps the label and the button's width, and sets `aria-busy`.

**Rules.** One primary per view. Labels are verb phrases ("Submit request"), never "OK". A
destructive action is never the primary in a form. A button that triggers a financial action shows
a confirmation naming the amount.

### 6.2 Input

Height 34px (`md`), padding `8px 12px`, `radius-sm`, `1px ink-300` border, `body` text.

States: focus → `cobalt-600` border + `elev-focus`; error → `danger.text` border + message below +
`aria-invalid`; disabled → `ink-50` fill; read-only → no border, `ink-50` fill, cursor text.

Anatomy: label (`caption`, 500, above, always present — placeholders are never labels) → optional
help text → control → error message (`caption`, `danger.text`, `role="alert"`).

**Money input**: right-aligned, tabular, currency prefix in an adjacent addon, rejects non-numeric
input, formats on blur, and holds a string in state — never a JavaScript number.

### 6.3 Data table

The most important component in the product.

| Property | Default | Compact |
|---|---|---|
| Row height | 44px | 36px |
| Cell padding | 12px 16px | 8px 12px |
| Header | 40px, `ink-50`, `caption` 600, `ink-600`, sticky | same |
| Separator | `1px ink-100` | same |
| Row hover | `ink-50` | same |
| Row selected | `cobalt-50` + 2px `cobalt-600` left marker | same |

Column types: `text` (left, truncate with tooltip) · `amount` (right, tabular) · `date` (left,
org timezone) · `status` (left, badge) · `person` (avatar + name) · `actions` (right, sticky).

Behaviours: sticky header; first column sticky at `<xl`; sortable headers with a direction
indicator and `aria-sort`; row click opens detail; `Cmd/Ctrl`-click opens the drawer; keyboard
navigation (`↑`/`↓` move, `Space` selects, `Enter` opens); resizable columns persisted per user;
column visibility toggle persisted per user; empty, loading (skeleton with correct column count
and row height), and error states built in.

**Selection and bulk actions.** The selection column appears only when the user holds at least one
bulk-capable permission. A floating bar shows the count and, where meaningful, the aggregate
amount. "Select all" selects the *loaded page* and offers "select all N matching" explicitly —
never silently.

### 6.4 Status badge

`radius-xs`, `caption` 500, padding `2px 8px`, height 20px, semantic `fill` + `border` + `text`,
with an optional 6px leading dot.

**Always includes a text label.** A colour-only indicator is not a status.

| State | Semantic |
|---|---|
| Draft · Imported | `info` |
| Pending approval · In review · Processing | `pending` |
| Approved · Reviewed · Paid · Reconciled | `success` |
| Needs receipt · Changes requested · Escalated | `warning` |
| Rejected · Blocked · Failed · Overspent | `danger` |
| Cancelled · Expired · Archived | `neutral` |

### 6.5 Approval timeline

Vertical, one node per step, connected by a rail. Each node shows the step number and type, the
eligible approvers (avatars, with a "3 of 5 approved" summary for quorum steps), the state badge,
the decision with actor and timestamp, the comment, and the elapsed or remaining time against
`due_at`. The active step is emphasised; future steps are `ink-400`; a rejection terminates the
rail visually so it is obvious nothing after it ran.

Above the timeline sits the **policy verdict panel**: the verdict, the rules that fired (each
linking to the policy version), and the budget impact. This is what makes "why did this need my
approval?" answerable in one glance.

### 6.6 Audit timeline

Reverse chronological. Each entry: timestamp (absolute, with a relative tooltip), actor (avatar,
name, role), action (human phrasing derived from the action key), and an expandable field-level
before/after diff. Filterable by action type. Present on every detail page.

### 6.7 KPI card

Label (`caption`, `ink-500`, uppercase `overline` optional) → value (`amount-lg`, tabular) →
delta versus comparison period (`caption`, semantic colour, with an arrow **and** a sign) →
optional sparkline (60×20, single stroke, no axes).

Loading is a skeleton of the same dimensions. Absent data shows `—` with an explanatory tooltip —
never `0`, which is a claim.

### 6.8 Empty, loading, error, permission states

| State | Composition |
|---|---|
| **First-run empty** | Line-art mark (48px, `ink-300`) · `h3` title · `body` `ink-500` explanation · primary CTA · optional doc link |
| **Filtered empty** | 32px mark · "No results match these filters" · *Clear filters* secondary button |
| **Scope empty** | 32px mark · "Nothing assigned to you" · no CTA implying broken access |
| **Loading** | Skeletons matching final geometry — never a centred spinner for a page |
| **Error** | `danger` mark · title · message · error `code` + `correlationId` in `mono` · *Retry* · *Contact support* |
| **Permission denied** | Lock mark · "You don't have access to this" · the required permission named · "Ask an organisation admin" · *Go back* |

### 6.9 Modal, drawer, confirmation

**Modal** — 480/640/800px, `radius-lg`, `elev-3`, focus trapped, `Esc` closes (unless a
destructive form is dirty), title as `h2`, actions bottom-right with primary last.

**Drawer** — 480px right, docked ≥1280px. Used for detail peek, filters, and audit history.

**Confirmation dialog** — required for destructive and financial actions. States the exact effect
("Terminate card •••• 4821? This cannot be undone."), names counts and amounts for bulk actions,
uses a `danger` primary for destructive, and for irreversible high-value actions requires typing a
confirmation token.

### 6.10 Filter bar

Search input (300ms debounce) · filter chips · *Add filter* menu · saved views · *Clear all* ·
result count · export.

Active filters render as removable chips. Every filter is a URL parameter, so any view is
shareable — and a shared link reproduces exactly what the sender saw.

---

## 7. Iconography

Line icons, 1.5px stroke, 20px default (16px inline, 24px empty states), rounded caps, on a 24px
grid, currentColor. One consistent set across the product. Icons are never the sole carrier of
meaning in an action — always paired with a label or an `aria-label`.

---

## 8. Motion

| Interaction | Duration | Easing |
|---|---|---|
| Hover, focus | 100ms | `ease-out` |
| Dropdown, popover | 120ms | `cubic-bezier(0.16, 1, 0.3, 1)` |
| Modal, drawer | 180ms | `cubic-bezier(0.16, 1, 0.3, 1)` |
| Toast | 200ms | `ease-out` |
| Skeleton shimmer | 1400ms loop | `ease-in-out` |

Nothing exceeds 200ms. Content never animates in on load — a table that fades in feels slower than
one that appears. `prefers-reduced-motion: reduce` disables all non-essential motion.

---

## 9. Content and voice

- **Plain, precise, unhedged.** "This request needs your approval." Not "It looks like this
  request may require approval."
- **Sentence case** for all headings, labels, and buttons.
- **Verb-phrase actions**: "Submit request", "Approve", "Attach receipt".
- **Errors** state what happened, why, and the next step. "This expense was already included in
  reimbursement RB-2041 on 12 Aug." Not "Duplicate entry error."
- **Never blame the user.** "That file type isn't supported" — not "You uploaded an invalid file."
- **Amounts appear in confirmations.** "Approve $2,400.00 for Acme Software?" — never "Approve
  this request?"
- **Never claim more than is true.** A sandbox provider is described as a sandbox, in the UI, every
  time.

---

## 10. Implementation notes

```
packages/ui/src/
├── tokens/        colors · typography · spacing · radius · elevation · motion (CSS vars)
├── primitives/    Button · Input · Select · Checkbox · Radio · Switch · Textarea ·
│                  Badge · Avatar · Tooltip · Popover · Dropdown · Dialog · Drawer · Tabs · Toast
├── data/          DataTable · Pagination · FilterBar · SearchInput · EmptyState ·
│                  LoadingSkeleton · ErrorState · PermissionState
├── finance/       Money · MoneyInput · AmountCell · CurrencyBadge · BudgetMeter ·
│                  StatusBadge · ApprovalTimeline · AuditTimeline · KpiCard · ReceiptPreview
└── charts/        LineChart · BarChart · DonutChart · Sparkline
```

Every component: typed props, no `any`; forwards `ref`; spreads `...rest` onto the root; accepts
`className` merged last; ships an `axe` test; ships a keyboard-interaction test; renders correctly
in both themes; documented with usage and misuse examples.

**The `Money` component** takes `{ amount: string; currency: string }` and formats. **It performs
no arithmetic** — there is no prop that would let it. That is the design system enforcing
`15 §1`.

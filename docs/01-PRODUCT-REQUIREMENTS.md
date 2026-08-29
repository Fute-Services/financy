# 01 — Product Requirements Document

**Product:** Financy
**Category:** B2B company spend management and finance operations
**Status:** Baseline v1.0 — 2026-08-29
**Owner:** Product architecture

---

## 1. Vision

> Most companies discover their spending after it has already happened. Financy moves the
> decision forward: spend is authorised against a written policy *before* money leaves the
> business, evidence is captured *as* it is spent, and reconciliation becomes a review of an
> already-complete record rather than an archaeological dig.

Financy is the **control and orchestration layer** for company spending. It is deliberately not
a bank, a card network, or a ledger of record. It governs, records, and explains spend, and it
integrates with the financial institutions and accounting systems that actually move and book
money.

## 2. Mission

Give finance teams a single system that can answer, for any unit of company spending, all ten
questions below — instantly, completely, and with an audit trail:

1. Who spent the money?
2. What was purchased?
3. Why was it purchased?
4. Which team, project, or legal entity paid?
5. Was the spend allowed under policy?
6. Who approved it, and on what basis?
7. What receipt or invoice proves it?
8. How much budget remains?
9. Where should it post in accounting?
10. Can the whole history be audited without asking a human?

A feature that does not help answer one of these questions is not a Financy feature.

---

## 3. The problem

Finance operations in a growing company fail in a predictable sequence:

| Stage | What breaks | Cost |
|---|---|---|
| **Before spend** | Policy lives in a wiki page nobody reads. Approvals happen in chat. | Unbudgeted commitments; no enforcement. |
| **At spend** | Shared cards, personal cards, ad-hoc invoices. No context captured. | Nobody knows what a charge was *for*. |
| **After spend** | Receipts chased by email weeks later. Categorisation done from memory. | Month-end close takes days; errors are systemic. |
| **Reporting** | Spreadsheets exported from four systems and manually merged. | Numbers are stale and contested. |
| **Audit** | History is reconstructed from inboxes. | Audit findings; no defensible trail. |

The root cause is that **control, evidence, and record live in different systems** — and
frequently in no system at all. Financy's thesis is that these three must be one system, joined
by a single domain model, or the problem returns.

---

## 4. Target customers

**Primary (design target):** companies of **50–1,000 employees** that have outgrown ad-hoc
spending but cannot yet afford a full ERP deployment. They typically have:

- 1–5 people in a finance function, with no dedicated systems administrator.
- Multiple departments with real budget ownership.
- 1–3 legal entities, possibly in different currencies.
- Between 200 and 20,000 transactions per month.
- An accounting system (QuickBooks, Xero, or NetSuite) that is the book of record.

**Secondary:** 10–50 employee companies adopting spend discipline early; and 1,000–5,000
employee companies using Financy for a single division.

**Explicitly not the design target:** consumer personal finance, sole traders, or companies
wanting Financy to *be* their general ledger.

---

## 5. Personas

### 5.1 Priya — Finance Admin (the power user)

Controller or Head of Finance. Lives in the product daily. Owns close, budget accuracy, and
audit readiness.

- **Cares about:** completeness of evidence, correct coding, close speed, no surprises.
- **Frustrations:** chasing receipts; charges with no memo; discovering overspend after the fact.
- **Success looks like:** month-end close in two days instead of eight, with zero uncategorised
  transactions.
- **Design implication:** dense, keyboard-driven review queues; bulk actions; exports she trusts.

### 5.2 Daniel — Organisation Admin

COO, Head of Ops, or the technically-inclined founder. Configures the system, then visits rarely.

- **Cares about:** correct org structure, correct access, correct policy, integrations that work.
- **Frustrations:** permission models he cannot reason about; changes with unclear blast radius.
- **Success looks like:** onboarding a new department takes ten minutes and is self-evidently
  correct.
- **Design implication:** explicit settings with plain-language explanations of consequence;
  every configuration change audit-logged.

### 5.3 Marcus — Manager / Approver

Engineering or Marketing lead with budget responsibility. Approves; does not administer.

- **Cares about:** approving quickly with enough context to be accountable; knowing his budget.
- **Frustrations:** approval requests with no justification; being the bottleneck; no mobile access.
- **Success looks like:** a request he can decide on in under thirty seconds without asking a
  follow-up question.
- **Design implication:** the approval surface must carry *complete decision context* — amount,
  purpose, policy verdict, remaining budget, requester history — on one screen.

### 5.4 Aisha — Employee

Any person who spends company money. Uses Financy a handful of times a month, under time
pressure.

- **Cares about:** getting the thing she needs, and being reimbursed quickly.
- **Frustrations:** not knowing whether something is allowed, or where a request is stuck.
- **Success looks like:** requesting spend in under a minute and always knowing the status.
- **Design implication:** minimal forms, policy feedback *before* submission, visible status,
  frictionless receipt capture.

### 5.5 Robert — Auditor / Read-only

Internal or external auditor, or an investor-appointed reviewer. Present for short, intense
periods.

- **Cares about:** completeness, immutability, and the ability to trace any number to evidence.
- **Frustrations:** systems where history can be edited; gaps he cannot explain.
- **Success looks like:** picking any transaction at random and seeing its entire lifecycle,
  including who approved it and under which policy version.
- **Design implication:** an immutable audit log, and a read-only role that can see everything
  and change nothing.

---

## 6. Jobs to be done

| # | Job story | Persona | Phase |
|---|---|---|---|
| JTBD-01 | When I need to buy something for work, I want to know *before I commit* whether it is allowed, so I do not create a problem for finance. | Aisha | 2 |
| JTBD-02 | When a request reaches me, I want the full context in one place, so I can approve responsibly and fast. | Marcus | 2 |
| JTBD-03 | When money is spent, I want the reason and evidence captured at that moment, so I never have to reconstruct it. | Priya | 3 |
| JTBD-04 | When I review the month, I want every transaction already categorised and coded, so close is a review not a rebuild. | Priya | 3–6 |
| JTBD-05 | When I set a budget, I want to see commitments and actuals against it continuously, so I find overspend before it happens. | Marcus / Priya | 4 |
| JTBD-06 | When I onboard someone, I want their access, limits, and approval chain correct by default. | Daniel | 1 |
| JTBD-07 | When I pay a supplier, I want the same approval discipline as card spend, in one system. | Priya | 5 |
| JTBD-08 | When I close the books, I want a clean export my accounting system accepts on the first attempt. | Priya | 6 |
| JTBD-09 | When I am audited, I want to trace any number to its full history without asking anyone. | Robert | 1+ |
| JTBD-10 | When policy changes, I want to change it as configuration, not as an engineering ticket. | Daniel / Priya | 2 |

---

## 7. Product principles

These are decision rules. When a design question is contested, resolve it with the highest
applicable principle.

1. **Control before spend beats reporting after spend.** Preventing a bad charge is worth more
   than describing it beautifully.
2. **Evidence is captured at the moment of spend, or it is lost.** Every workflow that creates a
   financial record must also make capturing its justification the path of least resistance.
3. **The server is the only authority.** Permissions, totals, policy verdicts, and state
   transitions are decided server-side. The frontend renders decisions; it never makes them.
4. **Posted financial records are immutable.** Corrections are new, linked records. Nothing is
   silently overwritten.
5. **Policy is data, not code.** A new approval rule is a configuration change, evaluated by one
   engine, used identically by cards, expenses, bills, and purchase orders.
6. **Everything financial or privileged is audited.** If it changes money, access, or policy, it
   produces an audit event naming the actor.
7. **Tenant isolation is not a feature.** It is a structural property enforced at three
   independent layers, and it is never derived from client input.
8. **Density with clarity.** This is a professional tool used all day. Prefer information density
   and scannability over decorative whitespace — but never at the cost of comprehension.
9. **Never fake a financial rail.** Sandbox and mock providers are labelled as such in the UI and
   in the data. We do not imply money moved when it did not.
10. **Build the vertical slice, not the horizontal layer.** A feature ships with its schema, API,
    permissions, audit, tests, and UI states — or it has not shipped.

---

## 8. Product scope tiers

Detailed in `02-PRODUCT-SCOPE.md`. Summarised here:

### MVP (Phases 1–4) — "Control, evidence, and visibility"

Authentication, organisations, memberships, RBAC, departments, entities, audit log; spend
requests; the policy and approval engine; card abstraction; transactions; receipts, expenses,
and reimbursements; budgets; the dashboard, reports, and CSV export.

**MVP acceptance:** the first vertical slice in `05-USER-FLOWS.md` runs end to end against a real
database, a real API, real authorisation, and a real audit log.

### Post-MVP (Phases 5–6) — "Payables and the close"

Vendors, bills / accounts payable, procurement and purchase orders, accounting codes and
mappings, accounting export, reconciliation foundations, pilot hardening.

### Future platform (Phase 7) — "Real rails and scale"

Real card issuing providers, real payment execution, travel booking, AI-assisted coding and
anomaly detection, advanced multi-entity and multi-currency consolidation, enterprise SSO and
SCIM.

---

## 9. What Financy explicitly is not

Stating this prevents scope drift and prevents overstated claims.

- **Not a bank or a money transmitter.** Financy holds no funds. Phase 1–6 record and orchestrate;
  they do not move money.
- **Not a general ledger.** The customer's accounting system remains the book of record. Financy
  produces coded, reviewed data *for* it.
- **Not a card network or issuer.** Cards in the MVP are a **control abstraction** — a named spend
  authorisation with a limit, an owner, and a policy — backed by a mock provider. Real issuing is
  Phase 7 and requires a licensed partner.
- **Not compliant with any certification it has not obtained.** The product will not claim SOC 2,
  PCI DSS, ISO 27001, or any other certification. `07-NON-FUNCTIONAL-REQUIREMENTS.md` describes
  the *engineering posture* that would support future certification; that is a different claim
  and is worded as such.
- **Not a personal finance or expense-report-only tool.** Expense reports are one input among
  several, not the product.

---

## 10. Success criteria

### 10.1 Engineering milestone (the gate for calling the MVP real)

The first vertical slice completes with no manual database intervention and no stubbed
authorisation:

```text
Admin creates organisation
  → invites Employee
  → creates a spending Policy
  → Employee submits a spend request
  → Policy engine evaluates it and resolves an approval chain
  → Manager is notified and approves
  → approved spend is recorded as a commitment
  → a transaction is created / imported and matched to the request
  → Employee uploads a receipt
  → Finance reviews and codes the transaction
  → the budget reflects committed and actual amounts
  → the dashboard and reports include it
  → the audit log contains every step, with actors and timestamps
```

### 10.2 Product outcome measures (post-pilot)

| Measure | Target |
|---|---|
| Transactions with a receipt attached within 5 days | ≥ 90% |
| Transactions still uncategorised at close | ≤ 2% |
| Median time from spend request to decision | ≤ 8 business hours |
| Spend occurring outside an approved policy path | ≤ 1% |
| Month-end close duration | ≤ 3 business days |
| Budget overspend detected before month end | 100% |

### 10.3 Qualitative bar

An experienced controller should be able to use Financy for a full close cycle and conclude that
it is a serious finance system — not a dashboard demonstration. Concretely: they can trace any
number to its evidence, they never need to export to a spreadsheet to answer a basic question,
and they never find a screen that looks finished but does nothing.

---

## 11. Assumptions and open questions

| # | Assumption | Risk if wrong | Revisit at |
|---|---|---|---|
| A1 | Customers accept a mock card provider during pilot, because the value is control and evidence rather than issuance. | Pilot stalls on "where are the real cards?" | Phase 5 pilot review |
| A2 | Single base currency per legal entity is sufficient for MVP; FX is presentational. | Multi-currency customers blocked. | Phase 4 |
| A3 | CSV export is an acceptable accounting integration for pilot. | Pilot demands live sync. | Phase 6 |
| A4 | Approval chains are resolvable from department, entity, and manager relationships. | Complex matrix orgs need explicit chains. | Phase 2 |
| A5 | Email plus in-app notification is sufficient; no Slack/Teams required for MVP. | Approval latency stays high. | Phase 4 |

Open questions requiring a business decision are tracked in `20-DECISIONS.md` under
*Open Questions*.

# 02 — Product Scope

**Status:** Baseline v1.0 — 2026-08-29
**Derives from:** `01-PRODUCT-REQUIREMENTS.md`
**Governs:** `18-DEVELOPMENT-ROADMAP.md`

This document is the contract on *what gets built when*. Anything not listed as In Scope for the
current phase is out of scope for the current phase, regardless of how easy it looks.

---

## 1. Module inventory and phase assignment

The product is designed around fifteen domains. They are **designed** together (so the domain
model is coherent) and **built** in dependency order.

| # | Module | Phase built | MVP? | One-line purpose |
|---|---|---|---|---|
| 1 | Overview (dashboard) | 4 | Yes | Answer "where do we stand" in one screen. |
| 2 | Spend Management (requests) | 2 | Yes | Authorise spend before it happens. |
| 3 | Cards | 2 (abstraction) / 7 (real) | Abstraction only | A named, limited, policy-bound spend authorisation. |
| 4 | Transactions | 2–3 | Yes | The immutable record of money spent. |
| 5 | Expenses & Reimbursements | 3 | Yes | Out-of-pocket spend and paying it back. |
| 6 | Budgets | 4 | Yes | Allocated vs committed vs actual, continuously. |
| 7 | Bills / Accounts Payable | 5 | No | Supplier invoices through the same approval engine. |
| 8 | Procurement | 5 | No | Purchase requests and purchase orders. |
| 9 | Vendors | 5 | No | The supplier master record. |
| 10 | Reports | 4 | Yes | Backend-computed analysis and export. |
| 11 | Accounting | 6 | No | Coding, mapping, and export to the book of record. |
| 12 | People | 1 | Yes | Users, memberships, roles, managers, departments. |
| 13 | Policies | 2 | Yes | Data-driven spend rules and approval chains. |
| 14 | Settings | 1 (core) / ongoing | Partial | Organisation, entities, categories, integrations. |
| 15 | Audit Log | 1 | Yes | Immutable history of everything that matters. |

---

## 2. Phase definitions

Each phase has a hard exit criterion. A phase is not complete until its exit criterion is
demonstrable against a running system, per `19-DEFINITION-OF-DONE.md`.

### Phase 0 — Foundation (not a product phase)

Repository scaffolding, monorepo, TypeScript, lint, format, test harness, CI, `.env.example`,
Docker files for CI, shared packages skeleton, database connection.

**Exit:** `pnpm install && pnpm lint && pnpm test && pnpm build` succeeds from a clean clone;
CI runs the same commands.

---

### Phase 1 — Identity, tenancy, and audit

The foundation every other module depends on. No spend features.

**In scope**

- Authentication: registration of the first organisation, login, logout, session lifecycle.
- Password hashing (argon2id), password reset, MFA-*ready* schema (TOTP tables and step-up hooks
  present; enrolment UI deferred to Phase 6).
- Sessions: opaque server-side tokens, revocation, per-session device metadata, "sign out
  everywhere".
- Organisation: creation, profile, base currency, fiscal calendar, timezone.
- Entities: legal entities under an organisation.
- Departments: hierarchy, department head.
- Users, memberships, and the invitation lifecycle.
- Roles and permissions: the full permission catalogue and the RBAC guard.
- Manager relationships (used later by the approval resolver).
- Audit log: the append-only event store, the write path, and the read UI.
- Security events: login success/failure, lockout, privilege change.
- Application shell: navigation, layout, org switcher, user menu, permission-aware nav.
- People page: list, detail, invite, edit role, deactivate.
- Organisation settings pages: profile, entities, departments.
- Structured logging, request correlation IDs, error taxonomy, health endpoints.

**Out of scope:** anything involving money.

**Exit criterion**
An admin can register an organisation, invite a user with a chosen role, that user can accept
and log in, RBAC correctly permits and denies both users, a second organisation cannot see the
first's data (proven by an automated cross-tenant test), and every one of those actions appears
in the audit log with the correct actor.

---

### Phase 2 — Spend requests, policy engine, approvals

The heart of the product.

**In scope**

- Spend categories and the category tree.
- Policy and policy-rule schema; the policy authoring UI.
- The policy evaluation engine: deterministic, data-driven, versioned, fully unit-tested.
- The approval resolver: turning a policy outcome into a concrete approval chain.
- Approval workflows, steps, instances, and actions; sequential and parallel steps; delegation.
- The approval state machine, including timeout and escalation.
- Spend requests: draft, submit, evaluate, approve, reject, return for changes, cancel, expire.
- Notifications: in-app and email, for approval requests, decisions, and reminders.
- Card abstraction: the card domain model, lifecycle, limits, and the `CardProvider` port with a
  mock adapter.
- Transaction domain model and lifecycle skeleton; manual and CSV import; the `PaymentProvider`
  port with a sandbox adapter.
- Idempotency infrastructure for all provider-facing and mutating endpoints.

**Exit criterion**
A policy configured entirely through the UI produces the correct approval chain for at least six
distinct scenarios (under threshold, over threshold, cross-department, missing receipt, budget
breach, auto-approve), each covered by an automated test; a manager approves; the approval and
its policy verdict are audited with the policy version applied.

---

### Phase 3 — Evidence: receipts, expenses, reimbursements

**In scope**

- Receipt upload to private object storage; signed-URL access; MIME and content validation;
  size limits; malware-scan hook point.
- Receipt attachment to transactions and expenses; detach and replace with full history.
- Expenses: create, itemise, categorise, memo, submit, approve, reject, return.
- Reimbursements: batch creation, approval, marking paid, duplicate prevention.
- Finance review queue: transaction review, coding, exception handling.
- Policy exceptions: raising, explaining, resolving.
- The `OCRProvider` port with a no-op adapter and an async job hook (real OCR is Phase 7).
- Full linkage: spend request → approval → transaction → receipt → review → audit.

**Exit criterion**
The complete first vertical slice from `01 §10.1` runs end to end, and a duplicate-reimbursement
attempt is provably rejected by an automated test.

---

### Phase 4 — Budgets, dashboard, reporting

**In scope**

- Budgets and budget lines by department, entity, project, and category, over fiscal periods.
- Allocated / committed / actual / remaining, computed transactionally and safely under
  concurrency.
- Overspend behaviour: configurable soft warn, require finance approval, or hard block.
- Budget alerts at configurable thresholds.
- The Overview dashboard, driven entirely by backend aggregates.
- Reports: total spend, by department, by category, by vendor, budget vs actual, pending
  approvals, outstanding reimbursements, policy exceptions, uncategorised transactions.
- The shared filter model: date range, entity, department, employee, category, vendor, project,
  payment method, approval state, policy state.
- CSV export with permission checks, row-level tenant scoping, and audit logging of the export.

**Exit criterion**
No dashboard or report value is computed in the browser; two concurrent transactions against the
same budget produce a correct final balance under an automated concurrency test; an export
performed by a user is recorded in the audit log with its filter parameters.

**End of MVP.**

---

### Phase 5 — Vendors, bills, procurement

**In scope**

- Vendors: master record, contacts, payment details (tokenised/redacted), status, deduplication.
- Bills / AP: capture, line items, coding, approval **through the existing approval engine**,
  scheduling, marking paid, credit notes.
- Procurement: purchase requests, purchase orders, PO lines, receiving, and three-way match
  foundations (PO ↔ receipt ↔ bill).
- Commitment accounting: an approved PO consumes budget as *committed*.

**Constraint:** no new approval logic. Bills and POs are additional `spendType` inputs to the
Phase 2 engine. A second approval implementation is a design failure.

**Exit criterion** A bill and a purchase order each route through the same engine, evaluator, and
state machine as a spend request, verified by tests that assert the shared code path.

---

### Phase 6 — Accounting and pilot hardening

**In scope**

- Chart of accounts import; accounting codes; cost centres; tax codes; tracking dimensions.
- Mapping rules: category/department/entity/vendor → GL account and dimensions.
- Accounting status on transactions, expenses, reimbursements, and bills.
- Export to CSV in accounting-system-compatible layouts; the `AccountingProvider` port.
- Reconciliation foundations: statement import, matching, unmatched queues.
- Hardening: PostgreSQL row-level security, rate limits, MFA enrolment UI, step-up
  authentication, load testing, penetration-test remediation, backup and restore rehearsal.

**Exit criterion** A full period exports cleanly, re-import is idempotent, and RLS is proven by a
test that attempts cross-tenant access with a valid session for another organisation.

---

### Phase 7 — Real rails and platform scale

Real card issuing (licensed partner), real payment execution, travel, AI-assisted categorisation
and anomaly detection, advanced multi-entity consolidation and FX, enterprise SSO (OIDC/SAML) and
SCIM provisioning, public API and webhooks, mobile receipt capture.

**Gate:** Phase 7 begins only after a Phase 6 security review and a written decision on the
regulatory and partner posture for each rail. No real-money rail ships without it.

---

## 3. Explicitly out of scope (all phases, unless re-decided)

| Item | Why |
|---|---|
| Holding customer funds | Requires licensing Financy will not hold. |
| Being the general ledger | The accounting system is the book of record. |
| Payroll | Different domain, different compliance surface. |
| Tax filing or determination | Requires certified tax engines and jurisdiction logic. |
| Consumer/personal finance | Wrong customer. |
| Real-time FX trading or hedging | Out of category. |
| Any compliance certification claim | We do not claim what we have not obtained. |
| Microservices | Explicitly rejected — see ADR-0002. |
| Native mobile apps | Responsive web first; native reconsidered after Phase 6. |

---

## 4. Cross-cutting requirements present in every phase

These are not a phase. They are conditions on every feature, enforced by
`19-DEFINITION-OF-DONE.md`.

1. Server-side permission check on every endpoint.
2. Organisation scoping resolved from the session, never from the request body.
3. An audit event for every financial or privileged mutation.
4. Input validation via the shared Zod contract.
5. Money as `NUMERIC(20,4)` plus explicit currency; never a float; never authoritative from the
   client.
6. Idempotency on every non-GET endpoint that can be retried.
7. Loading, empty, error, and permission-denied states on every screen.
8. Unit, integration, and API tests; e2e for user-visible flows.
9. A database migration for every schema change.
10. Documentation updated in the same pull request.

---

## 5. MVP definition — the single-sentence version

> **The Financy MVP is a multi-tenant system in which an organisation can define its people,
> structure, and spending policies; employees can request spend that is evaluated against those
> policies and routed for approval; approved spend becomes tracked transactions with attached
> receipts, reviewed and categorised by finance; and budgets, dashboards, reports, and an
> immutable audit log are all computed from that single, server-authoritative record.**

Everything in Phases 1–4 exists to make that sentence true. Nothing in Phases 1–4 exists that is
not required by it.

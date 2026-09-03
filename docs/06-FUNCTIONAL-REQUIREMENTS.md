# 06 — Functional Requirements

**Status:** Baseline v1.0 — 2026-08-29
**Convention:** `FR-<domain>-<n>`. Identifiers are **stable** and are referenced from test names
(e.g. `describe('FR-POL-004', ...)`). Never renumber; deprecate instead.

**Priority:** `M` must (MVP) · `S` should (MVP if capacity) · `C` could (post-MVP) · `W` won't (this release)

---

## AUTH — Authentication and sessions (Phase 1)

| ID          | Requirement                                                                                                                             |     Pri     | Acceptance                                                                                   |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------- | :---------: | -------------------------------------------------------------------------------------------- |
| FR-AUTH-001 | A visitor can register, creating a user, an organisation, a default legal entity, and an `ORG_ADMIN` membership atomically.             |      M      | Partial failure leaves no rows; verified by an injected-fault integration test.              |
| FR-AUTH-002 | Passwords are hashed with argon2id (m=19456 KiB, t=2, p=1) and never logged, returned, or stored in plaintext.                          |      M      | Hash format asserted; a log-scanning test asserts no password value appears in any log line. |
| FR-AUTH-003 | Password policy: ≥ 12 characters, checked against a breached-password list, no composition rules.                                       |      M      | Rejects a known-breached password; accepts a long passphrase.                                |
| FR-AUTH-004 | Login issues an opaque 32-byte session token; only its SHA-256 hash is stored. Cookie is `httpOnly`, `Secure`, `SameSite=Lax`.          |      M      | DB contains no usable token; cookie attributes asserted.                                     |
| FR-AUTH-005 | Sessions expire after 30 minutes idle and 12 hours absolute.                                                                            |      M      | Both expiries covered by time-travel tests.                                                  |
| FR-AUTH-006 | A user can list their active sessions with device, IP, and last-seen, and revoke any individually or all at once.                       |      M      | Revoked session's next request returns 401.                                                  |
| FR-AUTH-007 | Changing a password revokes all other sessions and writes a security event.                                                             |      M      | Asserted.                                                                                    |
| FR-AUTH-008 | Login is rate-limited to 5 attempts per 15 minutes per IP+email; 5 consecutive failures lock the account for 15 minutes.                |      M      | 6th attempt returns 429; lockout produces `account.locked`.                                  |
| FR-AUTH-009 | Failed login returns an identical generic response whether or not the account exists.                                                   |      M      | Response body and timing variance within tolerance.                                          |
| FR-AUTH-010 | The schema and service layer support TOTP MFA (secret, backup codes, enrolment state) and a step-up challenge; enrolment UI is Phase 6. | M (schema)  | Tables exist; `requireStepUp()` guard implemented and unit-tested.                           |
| FR-AUTH-011 | Password reset uses a single-use, 1-hour, hash-stored token and reveals nothing about account existence.                                |      M      | Asserted.                                                                                    |
| FR-AUTH-012 | A user with multiple memberships selects an organisation at login and can switch later; switching resets all scoped state.              |      M      | Asserted.                                                                                    |
| FR-AUTH-013 | Deactivating a membership immediately revokes its sessions.                                                                             |      M      | Asserted.                                                                                    |
| FR-AUTH-014 | OIDC / SAML single sign-on via the `IdentityProvider` port.                                                                             | W (Phase 7) | Port defined in Phase 1; no adapter shipped.                                                 |

## ORG — Organisation, entities, departments (Phase 1)

| ID         | Requirement                                                                                                     | Pri | Acceptance                                         |
| ---------- | --------------------------------------------------------------------------------------------------------------- | :-: | -------------------------------------------------- |
| FR-ORG-001 | An organisation has a name, legal name, base ISO-4217 currency, timezone, fiscal year start month, and country. |  M  | Validated on create and update.                    |
| FR-ORG-002 | Base currency is immutable once any financial record exists.                                                    |  M  | Attempt returns `409 CURRENCY_LOCKED`.             |
| FR-ORG-003 | An organisation has ≥ 1 legal entity; the default is created at registration.                                   |  M  | Deleting the last entity is refused.               |
| FR-ORG-004 | Entities carry name, registration number, country, functional currency, and status.                             |  M  | —                                                  |
| FR-ORG-005 | Departments form a tree with a single root per organisation; cycles are rejected.                               |  M  | Cycle attempt returns `422 CYCLIC_HIERARCHY`.      |
| FR-ORG-006 | A department may have a head, who becomes the default approver for its members.                                 |  M  | Reflected in resolved chains.                      |
| FR-ORG-007 | Departments and entities are archived, never hard-deleted, when referenced by financial records.                |  M  | Archive sets `archived_at`; rows remain queryable. |
| FR-ORG-008 | Projects (optional cost dimension) can be created and linked to departments and entities.                       |  S  | —                                                  |
| FR-ORG-009 | Spend categories form a tree, seeded with a sensible default set, and are org-editable.                         |  M  | —                                                  |

## USR — People and access (Phase 1)

| ID         | Requirement                                                                                                       |     Pri     | Acceptance                                                                          |
| ---------- | ----------------------------------------------------------------------------------------------------------------- | :---------: | ----------------------------------------------------------------------------------- |
| FR-USR-001 | An admin invites a person by email with role, department, entity scope, and manager.                              |      M      | —                                                                                   |
| FR-USR-002 | Invitations are single-use, expire in 7 days, are hash-stored, and are revocable.                                 |      M      | Expired/consumed/revoked tokens all rejected.                                       |
| FR-USR-003 | Accepting an invitation creates the membership; an existing user gains a second membership without a new account. |      M      | —                                                                                   |
| FR-USR-004 | Each membership has exactly one role; roles are data, not enum constants.                                         |      M      | —                                                                                   |
| FR-USR-005 | The permission matrix in `03` is seeded and enforced server-side on every endpoint.                               |      M      | An automated test enumerates every route and asserts a permission guard is present. |
| FR-USR-006 | Scope (`SELF`/`DEPARTMENT`/`ENTITY`/`ORGANISATION`) is applied as a mandatory query predicate.                    |      M      | Repository unit tests assert the predicate is always present.                       |
| FR-USR-007 | The last `ORG_ADMIN` cannot be demoted, deactivated, or removed. (INV-04)                                         |      M      | Returns `409 LAST_ADMIN`.                                                           |
| FR-USR-008 | A member cannot change their own role or grant themselves permissions. (INV-03)                                   |      M      | Returns `403 SELF_ELEVATION_FORBIDDEN`.                                             |
| FR-USR-009 | A membership has a manager reference used by approval resolution; manager cycles are rejected.                    |      M      | —                                                                                   |
| FR-USR-010 | Deactivation preserves all historical records and reassigns or escalates pending approval steps.                  |      M      | —                                                                                   |
| FR-USR-011 | Every role, permission, membership, or scope change writes both an audit event and a security event. (INV-08)     |      M      | —                                                                                   |
| FR-USR-012 | Custom roles composed from the permission catalogue.                                                              | C (Phase 6) | Schema ready in Phase 1.                                                            |

## AUD — Audit (Phase 1)

| ID         | Requirement                                                                                                                                                           | Pri | Acceptance                                                               |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :-: | ------------------------------------------------------------------------ |
| FR-AUD-001 | Every mutation of a financial, permission, policy, or configuration record writes an audit event **in the same database transaction**.                                |  M  | Fault-injection test: rolling back the change also rolls back the event. |
| FR-AUD-002 | An audit event records action, resource type, resource ID, actor membership, organisation, before/after payload, IP, user agent, correlation ID, and timestamp.       |  M  | Schema + integration test.                                               |
| FR-AUD-003 | `audit_events` is append-only. No application code path and no API endpoint performs `UPDATE` or `DELETE` on it; the application DB role lacks those grants. (INV-06) |  M  | Grant assertion test + static check for forbidden operations.            |
| FR-AUD-004 | Audit events are filterable by date, actor, action, resource type, and resource ID, and are cursor-paginated.                                                         |  M  | —                                                                        |
| FR-AUD-005 | System-initiated changes record a `SYSTEM` actor with the originating job name and ID.                                                                                |  M  | Never a null actor.                                                      |
| FR-AUD-006 | Audit export is permission-gated and is itself audited.                                                                                                               |  M  | —                                                                        |
| FR-AUD-007 | Every detail page exposes that record's audit history.                                                                                                                |  M  | —                                                                        |

## SPD — Spend requests (Phase 2)

| ID         | Requirement                                                                                                                                           | Pri | Acceptance                                                         |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | :-: | ------------------------------------------------------------------ |
| FR-SPD-001 | A member creates a spend request with amount, currency, category, vendor/merchant, purpose, needed-by date, entity, department, and optional project. |  M  | —                                                                  |
| FR-SPD-002 | Drafts autosave server-side and are visible only to their creator.                                                                                    |  M  | —                                                                  |
| FR-SPD-003 | A dry-run evaluation endpoint returns the anticipated verdict and approval chain without persisting anything.                                         |  M  | No rows written; asserted.                                         |
| FR-SPD-004 | On submit, the request is evaluated authoritatively and the decision snapshot (verdict, matched rule IDs, policy version IDs) is persisted immutably. |  M  | Later policy edits do not alter the snapshot.                      |
| FR-SPD-005 | The lifecycle follows the state machine in `05 §D`; invalid transitions return `409 INVALID_STATE_TRANSITION`.                                        |  M  | Every illegal transition is enumerated in tests.                   |
| FR-SPD-006 | The amount is server-validated; any client-supplied total is ignored.                                                                                 |  M  | Test submits a mismatched total and asserts the server value wins. |
| FR-SPD-007 | Approval consumes budget as a `COMMITTED` movement.                                                                                                   |  M  | —                                                                  |
| FR-SPD-008 | Approved requests carry `valid_until` and auto-expire, releasing their commitment.                                                                    |  M  | Scheduled job tested.                                              |
| FR-SPD-009 | Submission is idempotent on `Idempotency-Key`.                                                                                                        |  M  | Duplicate key + same payload replays the original response.        |
| FR-SPD-010 | A requester may cancel while in `DRAFT`, `SUBMITTED`, `PENDING_APPROVAL`, or `CHANGES_REQUESTED`.                                                     |  M  | —                                                                  |

## POL — Policy engine (Phase 2)

| ID         | Requirement                                                                                                                                                                                            | Pri | Acceptance                                                                 |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | :-: | -------------------------------------------------------------------------- |
| FR-POL-001 | Policies are data: a policy has a name, scope, priority, effective window, status, and an ordered rule set.                                                                                            |  M  | No policy logic in any controller — enforced by an architecture lint rule. |
| FR-POL-002 | Rules are condition groups (`ALL`/`ANY`, nestable one level) over typed fields with typed operators.                                                                                                   |  M  | Schema-validated.                                                          |
| FR-POL-003 | Supported inputs: amount, currency, category, department, entity, project, vendor, merchant, spend type, requester role, manager chain depth, budget state, receipt presence, memo presence, day/date. |  M  | Each input covered by a unit test.                                         |
| FR-POL-004 | Supported outcomes: `ALLOW`, `BLOCK`, `AUTO_APPROVE`, `REQUIRE_APPROVER`, `REQUIRE_RECEIPT`, `REQUIRE_MEMO`, `REQUIRE_FINANCE_REVIEW`, `SET_ESCALATION`, `FLAG_EXCEPTION`.                             |  M  | Each covered.                                                              |
| FR-POL-005 | Evaluation is deterministic: identical context + identical policy versions ⇒ identical decision, including ordering of the resulting chain.                                                            |  M  | Property-based test over 10,000 generated contexts.                        |
| FR-POL-006 | Merge semantics: `BLOCK` dominates; approver requirements are unioned and de-duplicated; the strictest evidence requirement wins; `AUTO_APPROVE` applies only if no rule required an approver.         |  M  | Explicit matrix test.                                                      |
| FR-POL-007 | Policies are versioned; editing creates a new version and never mutates one already referenced by a decision.                                                                                          |  M  | —                                                                          |
| FR-POL-008 | A simulation endpoint and UI evaluate a policy against historical or hypothetical data, showing every rule that fires.                                                                                 |  M  | —                                                                          |
| FR-POL-009 | If no policy matches, the organisation's configured default outcome applies.                                                                                                                           |  M  | Default is `REQUIRE_APPROVER: manager` unless changed.                     |
| FR-POL-010 | The same engine serves spend requests, expenses, reimbursements, bills, and purchase orders, differing only by `spendType`.                                                                            |  M  | A test asserts all five call the identical evaluator entry point.          |
| FR-POL-011 | Evaluation completes within 50 ms p95 for an organisation with 100 policies and 1,000 rules.                                                                                                           |  S  | Benchmark in CI.                                                           |

## APR — Approvals (Phase 2)

| ID         | Requirement                                                                                                                        | Pri | Acceptance                                                          |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------- | :-: | ------------------------------------------------------------------- |
| FR-APR-001 | An approval instance is created from a policy decision with ordered steps.                                                         |  M  | —                                                                   |
| FR-APR-002 | Step types `SEQUENTIAL`, `PARALLEL_ALL`, `PARALLEL_ANY`, `QUORUM(n)` are all supported.                                            |  M  | Each covered by tests.                                              |
| FR-APR-003 | Approvers are resolved from: named membership, role, department head, manager chain position, or entity finance owner.             |  M  | —                                                                   |
| FR-APR-004 | A user can never approve their own request, including via delegation. (INV-02)                                                     |  M  | Returns `403 SELF_APPROVAL_FORBIDDEN`; tested for every spend type. |
| FR-APR-005 | Actions: approve, reject (reason required), return for changes (comment required), delegate.                                       |  M  | —                                                                   |
| FR-APR-006 | Rejection at any step terminates the whole instance immediately.                                                                   |  M  | —                                                                   |
| FR-APR-007 | Every action writes an immutable `approval_action` row and an audit event.                                                         |  M  | —                                                                   |
| FR-APR-008 | Steps have an optional timeout; on expiry the configured escalation applies (escalate, auto-approve, auto-reject, or notify only). |  M  | Job-driven; tested.                                                 |
| FR-APR-009 | Delegation is time-bounded, non-chaining, and records both the acting and the delegating membership.                               |  M  | —                                                                   |
| FR-APR-010 | Finance may override a stalled instance with a mandatory reason; the override is audited as such.                                  |  M  | —                                                                   |
| FR-APR-011 | Concurrent approvals of the same step are safe: exactly one succeeds, the other receives `409 STEP_NOT_ACTIONABLE`.                |  M  | Concurrency test with two simultaneous requests.                    |
| FR-APR-012 | An approver's queue shows only steps they are eligible to action, within their scope.                                              |  M  | —                                                                   |

## CRD — Cards (Phase 2 abstraction)

| ID         | Requirement                                                                                                                               |     Pri     | Acceptance                                                                                           |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------- | :---------: | ---------------------------------------------------------------------------------------------------- |
| FR-CRD-001 | A card is a named spend authorisation with a holder, purpose, limit, period, status, validity window, and governing policy.               |      M      | —                                                                                                    |
| FR-CRD-002 | Cards follow the lifecycle in `05 §G`.                                                                                                    |      M      | —                                                                                                    |
| FR-CRD-003 | The application never stores or transmits a PAN, CVV, or full expiry; only a provider reference, last four, and network.                  |      M      | A schema test asserts no such column exists; a response test asserts no such field is ever returned. |
| FR-CRD-004 | Limit changes create a `spend_limits` history row; the current limit is derived, never overwritten.                                       |      M      | —                                                                                                    |
| FR-CRD-005 | Issuance goes through the `CardProvider` port. The MVP adapter is a mock and is **labelled as a mock in the API response and in the UI**. |      M      | `provider = 'MOCK'` surfaced; UI shows a sandbox badge.                                              |
| FR-CRD-006 | Available amount = limit − used within the current period, computed server-side.                                                          |      M      | —                                                                                                    |
| FR-CRD-007 | Locking prevents new authorisations but preserves history; termination is irreversible.                                                   |      M      | —                                                                                                    |
| FR-CRD-008 | Real issuing provider integration.                                                                                                        | W (Phase 7) | —                                                                                                    |

## TXN — Transactions (Phase 2–3)

| ID         | Requirement                                                                                                                                                          | Pri | Acceptance                                            |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :-: | ----------------------------------------------------- |
| FR-TXN-001 | Transactions carry amount, currency, merchant, occurred-at, posted-at, method, card, member, entity, department, project, category, and provider reference.          |  M  | —                                                     |
| FR-TXN-002 | `(provider, provider_transaction_id)` is unique per organisation; replays are no-ops returning the existing record.                                                  |  M  | Duplicate webhook and duplicate CSV row both tested.  |
| FR-TXN-003 | Financial state follows `05 §H`; receipt, review, and accounting statuses are independent axes.                                                                      |  M  | —                                                     |
| FR-TXN-004 | A posted transaction's amount, currency, merchant, and occurred-at are immutable. Corrections are adjustment records linked to the original.                         |  M  | Update attempt returns `409 POSTED_RECORD_IMMUTABLE`. |
| FR-TXN-005 | Transactions can be matched to an approved spend request, manually or by rule (amount, merchant, and date window).                                                   |  M  | —                                                     |
| FR-TXN-006 | CSV import validates every row, reports per-row errors, imports only valid rows, and is idempotent on re-upload.                                                     |  M  | —                                                     |
| FR-TXN-007 | Finance can categorise, code, review, and flag exceptions, individually or in bulk.                                                                                  |  M  | Bulk actions are permission-checked per row.          |
| FR-TXN-008 | A posted transaction records an `ACTUAL` budget movement and releases any matching commitment atomically.                                                            |  M  | —                                                     |
| FR-TXN-009 | Currency conversion, where displayed, stores the rate, its source, and its as-of date on the transaction. Converted values are never treated as the source of truth. |  S  | —                                                     |

## EXP — Expenses, receipts, reimbursements (Phase 3)

| ID         | Requirement                                                                                                                        | Pri | Acceptance                                                                                |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------- | :-: | ----------------------------------------------------------------------------------------- |
| FR-EXP-001 | Members create expenses with amount, currency, date, category, merchant, memo, and receipts.                                       |  M  | —                                                                                         |
| FR-EXP-002 | Expenses follow `05 §J` and are evaluated by the same policy engine.                                                               |  M  | —                                                                                         |
| FR-EXP-003 | Policy can require a receipt; submission without one is `BLOCKED`, not rejected.                                                   |  M  | —                                                                                         |
| FR-EXP-004 | Receipts upload via signed URL to private storage; content type is verified by magic bytes, not by the declared MIME.              |  M  | An executable renamed `.pdf` is rejected.                                                 |
| FR-EXP-005 | Receipt reads always use a freshly issued short-TTL signed URL after a permission check. No object is publicly readable.           |  M  | Direct bucket access test returns denied.                                                 |
| FR-EXP-006 | Allowed types: PDF, JPEG, PNG, HEIC, WebP. Maximum 20 MB. EXIF stripped from images.                                               |  M  | —                                                                                         |
| FR-EXP-007 | A receipt attaches to at most one transaction and one expense; attach/detach history is preserved.                                 |  M  | —                                                                                         |
| FR-EXP-008 | Reimbursement batches group approved out-of-pocket expenses by person, entity, currency, and period, with a server-computed total. |  M  | —                                                                                         |
| FR-EXP-009 | An expense can appear in at most one reimbursement line, guaranteed by a unique database index.                                    |  M  | Concurrent double-batch attempt: one succeeds, one gets `409 EXPENSE_ALREADY_REIMBURSED`. |
| FR-EXP-010 | Marking a batch paid requires a payment reference and is audited.                                                                  |  M  | —                                                                                         |
| FR-EXP-011 | OCR runs asynchronously via the `OCRProvider` port; the MVP adapter is a no-op and never blocks submission.                        |  M  | —                                                                                         |

## BDG — Budgets (Phase 4)

| ID         | Requirement                                                                                               | Pri | Acceptance                                                                |
| ---------- | --------------------------------------------------------------------------------------------------------- | :-: | ------------------------------------------------------------------------- |
| FR-BDG-001 | Budgets scope to department, entity, project, or category over a fiscal period, with lines per period.    |  M  | —                                                                         |
| FR-BDG-002 | Each line tracks allocated, committed, actual, and remaining; remaining = allocated − committed − actual. |  M  | —                                                                         |
| FR-BDG-003 | All changes are append-only `budget_movements`; balances are materialised in the same transaction.        |  M  | Sum of movements always equals the materialised balance — invariant test. |
| FR-BDG-004 | Balance updates take a row lock on the budget line; concurrent updates produce a correct final balance.   |  M  | 50-way concurrency test.                                                  |
| FR-BDG-005 | Overspend behaviour is configurable per budget: `WARN`, `REQUIRE_APPROVAL`, or `BLOCK`.                   |  M  | Each covered.                                                             |
| FR-BDG-006 | Alerts fire at configurable thresholds (default 75 / 90 / 100 %) at most once per threshold per period.   |  M  | Idempotent alerting tested.                                               |
| FR-BDG-007 | Budget state is an input to policy evaluation.                                                            |  M  | —                                                                         |
| FR-BDG-008 | Commitments release on cancellation, expiry, or reversal, as a movement — never by deletion.              |  M  | —                                                                         |

## RPT — Reporting (Phase 4)

| ID         | Requirement                                                                                                                                                                              | Pri | Acceptance                                                        |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :-: | ----------------------------------------------------------------- |
| FR-RPT-001 | Reports: total spend, by department, by category, by vendor, budget vs actual, pending approvals, outstanding reimbursements, open bills, policy exceptions, uncategorised transactions. |  M  | —                                                                 |
| FR-RPT-002 | Every figure is computed by a backend query. No aggregate is computed in the browser.                                                                                                    |  M  | An architecture test forbids arithmetic over money in `frontend`. |
| FR-RPT-003 | The shared filter model applies across all reports and is URL-encoded.                                                                                                                   |  M  | —                                                                 |
| FR-RPT-004 | Reports honour the caller's scope; a manager's report covers only their department subtree.                                                                                              |  M  | Cross-scope test.                                                 |
| FR-RPT-005 | CSV export honours applied filters and scope, is audit-logged with parameters and row count, and is rate-limited.                                                                        |  M  | —                                                                 |
| FR-RPT-006 | Exports over 5,000 rows are queued and delivered by signed link.                                                                                                                         |  S  | —                                                                 |
| FR-RPT-007 | Dashboard aggregates respond within 500 ms p95 at 100,000 transactions per organisation.                                                                                                 |  S  | Benchmarked against a seeded dataset.                             |

## VND / BIL / PRC — Vendors, bills, procurement (Phase 5)

| ID         | Requirement                                                                                                                             | Pri | Acceptance                         |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------- | :-: | ---------------------------------- |
| FR-VND-001 | Vendors carry name, legal name, tax ID, category, contacts, addresses, payment details (redacted at rest and in responses), and status. |  M  | —                                  |
| FR-VND-002 | Duplicate detection on create by normalised name and tax ID; merging is non-destructive via `merged_into_id`.                           |  S  | —                                  |
| FR-BIL-001 | Bills carry vendor, number, issue and due dates, currency, lines, and attachments; totals are computed server-side from lines.          |  M  | Client-supplied totals ignored.    |
| FR-BIL-002 | `(vendor_id, bill_number)` is unique per organisation.                                                                                  |  M  | —                                  |
| FR-BIL-003 | Bills route through the **existing** approval engine with `spendType = BILL`.                                                           |  M  | Test asserts the shared code path. |
| FR-BIL-004 | A paid bill's amounts are immutable; corrections are credit notes.                                                                      |  M  | —                                  |
| FR-PRC-001 | Purchase requests become purchase orders on approval; approved POs commit budget.                                                       |  M  | —                                  |
| FR-PRC-002 | Receiving records quantities per PO line.                                                                                               |  M  | —                                  |
| FR-PRC-003 | Three-way match (PO ↔ receipt ↔ bill) with a configurable tolerance; variances go to an exception queue.                                |  S  | —                                  |

## ACC — Accounting (Phase 6)

| ID         | Requirement                                                                                                        |     Pri     | Acceptance               |
| ---------- | ------------------------------------------------------------------------------------------------------------------ | :---------: | ------------------------ |
| FR-ACC-001 | Chart of accounts, cost centres, and tax codes are importable and manageable.                                      |      M      | —                        |
| FR-ACC-002 | Mapping rules derive GL account and dimensions from category, department, entity, and vendor, with a test harness. |      M      | —                        |
| FR-ACC-003 | Only reviewed **and** coded records are exportable.                                                                |      M      | —                        |
| FR-ACC-004 | Export produces a batch with a checksum, row count, record IDs, and actor; records are marked exported.            |      M      | —                        |
| FR-ACC-005 | Re-running an export excludes already-exported records — it is idempotent.                                         |      M      | —                        |
| FR-ACC-006 | Exports are balanced (debits = credits per journal) or the export aborts with an integrity error.                  |      M      | —                        |
| FR-ACC-007 | An exported record cannot be edited; adjustments appear in the next export.                                        |      M      | —                        |
| FR-ACC-008 | Live sync with QuickBooks / Xero / NetSuite via `AccountingProvider` adapters.                                     | W (Phase 7) | Port defined in Phase 6. |

## NOT / JOB — Notifications and async (Phases 2–4)

| ID         | Requirement                                                                                                                                  | Pri | Acceptance                                                       |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------- | :-: | ---------------------------------------------------------------- |
| FR-NOT-001 | In-app and email notifications for approval requested, decided, receipt missing, budget threshold, reimbursement paid, and policy exception. |  M  | —                                                                |
| FR-NOT-002 | Per-user notification preferences by channel and event type.                                                                                 |  S  | —                                                                |
| FR-NOT-003 | Notifications are queued, never sent inline in a request.                                                                                    |  M  | —                                                                |
| FR-JOB-001 | Every job is idempotent, keyed, retried with exponential backoff (max 5), and dead-lettered with an alert.                                   |  M  | Each job has a duplicate-delivery test.                          |
| FR-JOB-002 | The queue is accessed only through `QueuePort`; the inline adapter runs locally and in tests, BullMQ in staging and production.              |  M  | No direct BullMQ import outside the adapter — architecture lint. |
| FR-JOB-003 | Scheduled jobs: approval reminders, escalations, request expiry, budget alerts, scheduled reports, reconciliation.                           |  M  | —                                                                |

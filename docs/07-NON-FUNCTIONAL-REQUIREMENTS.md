# 07 — Non-Functional Requirements

**Status:** Baseline v1.0 — 2026-08-29
**Convention:** `NFR-<area>-<n>`. Referenced from benchmarks and CI gates.

---

## 1. Performance

Targets assume the **reference workload**: one organisation with 500 members, 100,000
transactions, 200 policies, and 2,000 rules, on a 2 vCPU / 4 GB API instance and a 2 vCPU / 8 GB
PostgreSQL instance.

| ID           | Requirement                                               | Target                                         | Verified by                                |
| ------------ | --------------------------------------------------------- | ---------------------------------------------- | ------------------------------------------ |
| NFR-PERF-001 | API read endpoint latency                                 | p50 ≤ 120 ms, p95 ≤ 400 ms, p99 ≤ 900 ms       | k6 suite in CI nightly                     |
| NFR-PERF-002 | API write endpoint latency                                | p95 ≤ 600 ms                                   | k6                                         |
| NFR-PERF-003 | Policy evaluation                                         | p95 ≤ 50 ms                                    | Micro-benchmark, CI gate                   |
| NFR-PERF-004 | Dashboard aggregate endpoints                             | p95 ≤ 500 ms                                   | k6 against seeded data                     |
| NFR-PERF-005 | Transaction list, 50 rows with all filters                | p95 ≤ 350 ms                                   | k6                                         |
| NFR-PERF-006 | Web LCP on the transactions list                          | ≤ 2.0 s on a mid-tier laptop, cable connection | Lighthouse CI                              |
| NFR-PERF-007 | Web INP                                                   | ≤ 200 ms                                       | Lighthouse CI                              |
| NFR-PERF-008 | Initial JS payload for an authenticated route             | ≤ 250 KB gzipped                               | `size-limit` CI gate                       |
| NFR-PERF-009 | CSV export, 50,000 rows                                   | ≤ 60 s, streamed, memory-bounded               | Load test                                  |
| NFR-PERF-010 | No N+1 queries on any list endpoint                       | 0 detected                                     | Query-count assertion in integration tests |
| NFR-PERF-011 | Every list endpoint's primary filter path is index-backed | No sequential scan on tables > 10,000 rows     | `EXPLAIN` assertions in CI                 |

**Standing rule:** any endpoint returning a collection must be paginated. There is no unbounded
list endpoint anywhere in the API.

---

## 2. Scalability

| ID          | Requirement                                                                                                                                                                                        |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| NFR-SCL-001 | The system supports 1,000 organisations, 50,000 members, and 10 million transactions without schema change.                                                                                        |
| NFR-SCL-002 | The API is stateless; horizontal scaling requires no sticky sessions (session state is in PostgreSQL, not memory).                                                                                 |
| NFR-SCL-003 | Workers scale independently of the HTTP tier; both are the same deployable with different entrypoints.                                                                                             |
| NFR-SCL-004 | Large tables (`transactions`, `audit_events`, `notifications`) are designed for time-based partitioning; partitioning is enabled when a table exceeds 50 million rows, without application change. |
| NFR-SCL-005 | Read-heavy reporting can be moved to a read replica by configuration only.                                                                                                                         |
| NFR-SCL-006 | Connection pooling is mandatory; the pool is sized to the instance count so PostgreSQL's `max_connections` is never approached.                                                                    |

---

## 3. Availability and resilience

| ID          | Requirement                                                                      | Target                                                                                                                                                                   |
| ----------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| NFR-AVL-001 | Production availability                                                          | 99.9 % monthly (≈ 43 min downtime)                                                                                                                                       |
| NFR-AVL-002 | Planned maintenance                                                              | Zero-downtime deploys; migrations are backward-compatible (expand/contract)                                                                                              |
| NFR-AVL-003 | Recovery point objective (RPO)                                                   | ≤ 5 minutes — PITR with continuous WAL archiving                                                                                                                         |
| NFR-AVL-004 | Recovery time objective (RTO)                                                    | ≤ 1 hour                                                                                                                                                                 |
| NFR-AVL-005 | Backups                                                                          | Nightly full + continuous WAL; **restore rehearsed quarterly** — an untested backup is not a backup                                                                      |
| NFR-AVL-006 | Graceful degradation                                                             | If the queue is unavailable, synchronous paths still work; jobs buffer and drain. If storage is unavailable, receipt upload fails cleanly without corrupting the record. |
| NFR-AVL-007 | Health endpoints                                                                 | `/health/live` (process) and `/health/ready` (DB, queue, storage)                                                                                                        |
| NFR-AVL-008 | Timeouts and circuit breakers on every outbound provider call; no unbounded wait |
| NFR-AVL-009 | Graceful shutdown drains in-flight requests and jobs before exit                 |

---

## 4. Security

Full detail in `12-SECURITY-MODEL.md`. Requirements summarised for tracking.

| ID          | Requirement                                                                                                                                         |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| NFR-SEC-001 | TLS 1.2+ in transit; HSTS with preload in production.                                                                                               |
| NFR-SEC-002 | Encryption at rest for the database, object storage, and backups.                                                                                   |
| NFR-SEC-003 | Application-level encryption (AES-256-GCM, envelope) for vendor bank details and MFA secrets.                                                       |
| NFR-SEC-004 | Tenant isolation enforced at three independent layers: request context, ORM extension, PostgreSQL RLS.                                              |
| NFR-SEC-005 | Server-side authorisation on every endpoint. No endpoint relies on the frontend for access control.                                                 |
| NFR-SEC-006 | Secrets come from the environment or a secret manager. No secret in source control, ever.                                                           |
| NFR-SEC-007 | Dependency scanning on every PR; no known critical or high vulnerability may be merged.                                                             |
| NFR-SEC-008 | Static analysis and secret scanning in CI, blocking on findings.                                                                                    |
| NFR-SEC-009 | Rate limiting on authentication, export, upload, and all write endpoints.                                                                           |
| NFR-SEC-010 | Security headers: CSP (no `unsafe-inline` for scripts), `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, `X-Frame-Options: DENY`. |
| NFR-SEC-011 | No PAN, CVV, or full card expiry is stored, logged, or transmitted anywhere in the system.                                                          |
| NFR-SEC-012 | Uploads validated by content sniffing; served only via short-TTL signed URLs after an authorisation check.                                          |
| NFR-SEC-013 | Penetration test before any production pilot; findings triaged and critical/high remediated before launch.                                          |

---

## 5. Privacy and data protection

| ID          | Requirement                                                                                                                                                                              |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| NFR-PRV-001 | Personal data is inventoried in `12-SECURITY-MODEL.md §9` with lawful basis and retention.                                                                                               |
| NFR-PRV-002 | Data minimisation: no personal data is collected without a stated product purpose.                                                                                                       |
| NFR-PRV-003 | Export of a data subject's personal data on request (machine-readable).                                                                                                                  |
| NFR-PRV-004 | Erasure of a data subject's personal data, subject to statutory financial retention: personal identifiers are pseudonymised while the financial record and its audit trail are retained. |
| NFR-PRV-005 | Retention: financial records 7 years; audit events 7 years; security events 2 years; session records 90 days after expiry; notifications 1 year.                                         |
| NFR-PRV-006 | Data residency is configurable per deployment; a single organisation's data never spans regions.                                                                                         |
| NFR-PRV-007 | Personal data is never sent to a third-party provider without an explicit configured integration and a recorded data-processing basis.                                                   |

---

## 6. Compliance posture — an honest statement

**Financy makes no compliance certification claims.** It is not SOC 2 attested, not PCI DSS
assessed, not ISO 27001 certified, and not HIPAA relevant. It is not a regulated financial
institution and does not hold customer funds.

What this document _does_ commit to is an **engineering posture** consistent with a future audit:

| ID          | Posture commitment                                                                                                                                                        |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| NFR-CMP-001 | Access control is role-based, least-privilege, and fully audited — the evidence a SOC 2 CC6 control would require exists as data.                                         |
| NFR-CMP-002 | Change management is enforced: every change is a reviewed pull request with CI gates, linked to an issue.                                                                 |
| NFR-CMP-003 | Card data is out of scope by design. Financy never touches PAN or CVV; real issuing (Phase 7) will use a provider's tokenised vault so PCI scope stays with the provider. |
| NFR-CMP-004 | Audit trails are immutable and complete, satisfying the evidentiary requirement common to financial audits.                                                               |
| NFR-CMP-005 | Backup, restore, and incident-response procedures are documented and rehearsed.                                                                                           |
| NFR-CMP-006 | No marketing, UI copy, or documentation may state or imply a certification the company has not obtained. This is a hard product rule.                                     |

---

## 7. Financial correctness

These are the requirements that make this a finance system rather than a CRUD application.
Each maps to a test in `16-TESTING-STRATEGY.md §6`.

| ID          | Requirement                                                                                                                                                                                                       |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| NFR-FIN-001 | Money is stored as `NUMERIC(20,4)` with a separate ISO-4217 currency column. IEEE-754 floating point is never used for a monetary value, at any layer.                                                            |
| NFR-FIN-002 | Money crosses the API boundary as a **string** with an explicit currency, never as a JSON number.                                                                                                                 |
| NFR-FIN-003 | Arithmetic uses a decimal library (`decimal.js` via the `Money` value object in `packages/core`). The `+`, `-`, `*` operators are never applied to a monetary value.                                              |
| NFR-FIN-004 | Rounding is banker's rounding (half-to-even) at 2 decimal places for presentation and settlement; intermediate values retain 4 decimals. The rounding mode is defined once and is not configurable per call site. |
| NFR-FIN-005 | Amounts in different currencies are never summed. An attempt raises `CurrencyMismatchError` at the domain layer.                                                                                                  |
| NFR-FIN-006 | Posted financial records are immutable. Corrections are new, linked adjustment records. No `UPDATE` touches a posted amount.                                                                                      |
| NFR-FIN-007 | Every mutating endpoint that can be retried accepts and honours an `Idempotency-Key`.                                                                                                                             |
| NFR-FIN-008 | Duplicate provider events are impossible by unique constraint, not by application check alone.                                                                                                                    |
| NFR-FIN-009 | Budget balance updates are serialised by row lock; the sum of movements always equals the materialised balance.                                                                                                   |
| NFR-FIN-010 | An expense can be reimbursed at most once, guaranteed by a unique index.                                                                                                                                          |
| NFR-FIN-011 | Any multi-record financial operation is atomic — a single database transaction, including its audit event.                                                                                                        |
| NFR-FIN-012 | Totals are computed server-side from persisted line items. A client-supplied total is ignored, never trusted, and never merely validated.                                                                         |
| NFR-FIN-013 | Financial state transitions are validated against an explicit state machine. There is no path to an undefined state.                                                                                              |

---

## 8. Observability

| ID          | Requirement                                                                                                                                                               |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| NFR-OBS-001 | Structured JSON logs (Pino) with a correlation ID on every line.                                                                                                          |
| NFR-OBS-002 | Every request carries a correlation ID, accepted from `X-Correlation-Id` or generated, returned in the response, and surfaced in the UI's error states.                   |
| NFR-OBS-003 | OpenTelemetry traces across HTTP, database, queue, and provider calls, with context propagated into workers.                                                              |
| NFR-OBS-004 | Metrics: request rate, error rate, duration histograms, queue depth, job latency and failure rate, DB pool saturation, and the business metrics in NFR-OBS-005.           |
| NFR-OBS-005 | Business metrics emitted as counters: spend requests submitted, approvals completed, policy blocks, transactions imported, receipts uploaded, exports run.                |
| NFR-OBS-006 | Error tracking with release tagging and source maps.                                                                                                                      |
| NFR-OBS-007 | **Logs never contain** passwords, session tokens, PAN/CVV, MFA secrets, or full receipt contents. A redaction layer is applied at the logger, and a test asserts it.      |
| NFR-OBS-008 | Alerts on: error rate > 1 % over 5 min, p95 latency > 2× target over 10 min, queue depth > 1,000, any dead-letter arrival, failed login spike, and export volume anomaly. |
| NFR-OBS-009 | Audit events are queryable independently of application logs; they are a product feature, not telemetry.                                                                  |

---

## 9. Maintainability

| ID          | Requirement                                                                                                                                                                                                                                                                                                                 |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| NFR-MNT-001 | TypeScript `strict: true`, plus `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`. No `any` without an inline justification comment.                                                                                                                                                                              |
| NFR-MNT-002 | ESLint and Prettier enforced in CI; formatting is never a review topic.                                                                                                                                                                                                                                                     |
| NFR-MNT-003 | Architecture lint rules, enforced in CI: no cross-module imports except through a module's public index; no policy logic outside `modules/policies`; no direct BullMQ import outside the queue adapter; no money arithmetic in `frontend`; no `PrismaClient` import outside `packages/db` and the platform database module. |
| NFR-MNT-004 | Every domain module exposes an explicit public API (`index.ts`); everything else is internal.                                                                                                                                                                                                                               |
| NFR-MNT-005 | Coverage floors: 90 % for `packages/core` and the policy/approval modules; 80 % overall for `backend`. CI fails below.                                                                                                                                                                                                     |
| NFR-MNT-006 | Every schema change ships as a checked-in, reviewed migration. `prisma db push` is forbidden outside a developer's scratch database.                                                                                                                                                                                        |
| NFR-MNT-007 | Public functions in domain services carry TSDoc stating purpose, invariants, and thrown errors.                                                                                                                                                                                                                             |
| NFR-MNT-008 | Dependencies are justified. Adding one requires a note in the PR describing what it replaces and why it is preferable to writing it.                                                                                                                                                                                        |

---

## 10. Usability and accessibility

| ID         | Requirement                                                                                                      |
| ---------- | ---------------------------------------------------------------------------------------------------------------- |
| NFR-UX-001 | WCAG 2.1 AA across the application, verified by `axe` in CI and by a keyboard-only manual pass each release.     |
| NFR-UX-002 | Every interactive element is keyboard-reachable and operable, including the data table.                          |
| NFR-UX-003 | Every asynchronous operation shows a loading state within 100 ms and a result or error within its timeout.       |
| NFR-UX-004 | Every screen implements the four required states: loading, empty, error, permission-denied.                      |
| NFR-UX-005 | Destructive and financial actions require explicit confirmation naming the exact effect (record, count, amount). |
| NFR-UX-006 | Error messages state what happened, why, and what to do next — and include the error code and correlation ID.    |
| NFR-UX-007 | Amounts render with the correct currency symbol, locale grouping, and tabular figures, right-aligned.            |
| NFR-UX-008 | Dates render in the organisation's timezone with the timezone shown where ambiguity matters.                     |
| NFR-UX-009 | Supported browsers: current and previous major versions of Chrome, Edge, Firefox, and Safari.                    |
| NFR-UX-010 | Usable at 1280×800 and above without horizontal scrolling; degrades to stacked cards below `lg`.                 |

---

## 11. Internationalisation

| ID           | Requirement                                                                                                                                  |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| NFR-I18N-001 | All UI strings live in a message catalogue from day one. English is the only shipped locale in the MVP; hard-coded strings are a lint error. |
| NFR-I18N-002 | Dates, numbers, and currencies use `Intl` with the user's locale and the organisation's timezone.                                            |
| NFR-I18N-003 | Multi-currency data is supported from day one; multi-currency _consolidation_ is Phase 7.                                                    |
| NFR-I18N-004 | All storage and transport of timestamps is UTC; conversion happens only at the presentation edge.                                            |

---

## 12. Operational constraints (from the audit)

| ID          | Requirement                                                                                                                                                                                                 |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| NFR-OPS-001 | The system must run on a Windows development host with **no Docker, no WSL, and no Redis**. Local development uses the native PostgreSQL and the inline queue and filesystem storage adapters.              |
| NFR-OPS-002 | All developer scripts are cross-platform. Shell-specific syntax in `package.json` scripts is prohibited.                                                                                                    |
| NFR-OPS-003 | Local ports: web `3100`, API `4100`. All ports are environment-driven.                                                                                                                                      |
| NFR-OPS-004 | A clean clone reaches a running application with: install dependencies, copy `.env.example`, set the database URL, run migrations, seed, start. No more than six steps, documented in the root `README.md`. |
| NFR-OPS-005 | CI runs the full check suite (lint, typecheck, unit, integration, API, build) on every pull request in under 15 minutes.                                                                                    |

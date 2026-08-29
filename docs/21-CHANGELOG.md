# 21 — Changelog

All notable changes to Financy are recorded here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Until `1.0.0`, the product is pre-release: the API surface may change between minor versions, and
`/v1` stability guarantees begin at `1.0.0`.

---

## [Unreleased]

### Added
- Nothing yet. Phase 0 scaffolding is next.

---

## [0.1.0] — 2026-08-29 — Documentation baseline

The complete design of the system, before any implementation. No application code exists at this
version.

### Added

**Audit**
- `REPOSITORY_AUDIT.md` — baseline audit of an empty repository and a partially provisioned
  Windows host. Findings P1–P6 recorded, each with a mitigation that is reflected in an ADR.

**Product definition**
- `01-PRODUCT-REQUIREMENTS.md` — vision, mission, five personas, ten jobs-to-be-done, ten product
  principles, success criteria, and an explicit statement of what Financy is *not*.
- `02-PRODUCT-SCOPE.md` — fifteen modules mapped to seven phases, each with a hard exit criterion;
  the one-sentence MVP definition.
- `03-USER-ROLES-PERMISSIONS.md` — five roles, the full permission matrix across seven domains,
  four scope levels, ten enforced invariants (INV-01…INV-10), and the delegation model.

**Behaviour**
- `04-INFORMATION-ARCHITECTURE.md` — navigation, the complete route map, and the module surface
  contract that every module must satisfy (list, detail, create, edit, approve, four states,
  search, filter, sort, paginate, bulk, export, audit, related).
- `05-USER-FLOWS.md` — the first vertical slice as a sequence diagram with its end-state
  assertions, plus seventeen workflow diagrams (A–Q) covering onboarding through audit.
- `06-FUNCTIONAL-REQUIREMENTS.md` — 130+ numbered, testable requirements across fifteen domains.
- `07-NON-FUNCTIONAL-REQUIREMENTS.md` — performance, scalability, availability, security, privacy,
  financial correctness, observability, maintainability, accessibility, and the operational
  constraints imposed by the development host.

**Technical design**
- `08-ARCHITECTURE.md` — the modular monolith, its layering, module map, request pipeline,
  boundary enforcement, error taxonomy, and deployment topology.
- `09-DATABASE-DESIGN.md` — four ERDs, the full table catalogue, financial invariants, the
  immutability trigger, the budget movement ledger, composite tenant foreign keys, indexing
  strategy, and the expand/contract migration policy.
- `10-API-SPECIFICATION.md` — REST conventions, money as a string, pagination, idempotency,
  optimistic concurrency, the full endpoint catalogue, stable error codes, rate limits, and the
  audit implication of every mutation.
- `11-APPROVAL-POLICY-ENGINE.md` — the policy context, rule schema, evaluation algorithm, nine
  merge precedence rules, chain resolution with double self-approval exclusion, both state
  machines, worked examples, and the testing requirements.
- `12-SECURITY-MODEL.md` — trust boundaries, authentication, four-layer tenant isolation, a
  twenty-entry STRIDE threat model, cryptography, the personal data inventory, incident response,
  and an explicit statement of non-claims.
- `13-INTEGRATIONS.md` — eight provider ports, the common adapter contract, webhook handling, and
  the honesty rules for sandbox providers.
- `14-ASYNC-JOBS.md` — the queue port, the six-part job contract, the full job catalogue, worker
  topology, and the requirement that every job prove idempotency by test.
- `15-REPORTING-ANALYTICS.md` — the report registry, the shared filter model with scope
  intersection, currency handling, query strategy, and export safety.
- `UI-DESIGN-SYSTEM.md` — an original visual identity: the Ink and Cobalt palettes, semantic and
  data-visualisation colours, typography with tabular figures, spacing, elevation, layout grid,
  and specifications for every component including the data table and approval timeline.

**Execution**
- `16-TESTING-STRATEGY.md` — the test pyramid, coverage floors, fifteen financial correctness
  scenarios, twenty-four security scenarios, and the CI gate.
- `17-DEPLOYMENT.md` — five environments, the local setup that requires no Docker, full
  configuration reference with production guards, the release process, zero-downtime deployment,
  backup policy with quarterly restore rehearsal, and nine runbooks.
- `18-DEVELOPMENT-ROADMAP.md` — phases 0–7 broken into epics and numbered tasks, with a twelve-item
  risk register.
- `19-DEFINITION-OF-DONE.md` — the eight-section completion checklist, the definition of ready,
  the phase-level gate, and thirteen named anti-patterns.
- `20-DECISIONS.md` — sixteen ADRs with genuine alternatives and consequences, plus seven open
  business questions.
- `README.md` — the documentation hierarchy, source-of-truth rules, and change-management order.

### Decisions recorded
ADR-0001 pnpm + Turborepo · ADR-0002 modular monolith · ADR-0003 Prisma over Drizzle ·
ADR-0004 `NUMERIC(20,4)` + explicit currency · ADR-0005 opaque DB sessions ·
ADR-0006 `QueuePort` with inline and BullMQ adapters · ADR-0007 Docker optional locally ·
ADR-0008 `DocumentProvider` with a local signed-URL adapter · ADR-0009 ports 3100/4100 ·
ADR-0010 four-layer tenant isolation · ADR-0011 policy as versioned data ·
ADR-0012 immutable financial records · ADR-0013 server-side authorisation and computation ·
ADR-0014 provider ports with honest sandbox labelling · ADR-0015 REST over GraphQL ·
ADR-0016 audit inside the business transaction.

### Known gaps
- **OQ-07** — PostgreSQL credentials for the application role are not yet available (audit P1).
  Documentation and schema authoring are unaffected; running migrations is blocked until resolved.

---

## Changelog conventions

**Categories:** `Added` · `Changed` · `Deprecated` · `Removed` · `Fixed` · `Security`.

**Every entry** is written for a reader who did not write the code: what changed, and what it means
for them. `Security` entries are always listed, even when the fix is minor, so a customer can
audit the security history without reading commits.

**Every phase completion** gets a minor version. Breaking API changes wait for a major version and
a `/v2` path.

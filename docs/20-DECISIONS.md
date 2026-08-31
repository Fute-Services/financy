# 20 — Architecture Decision Records

**Status:** Living document — 2026-08-29

Every significant architectural decision is recorded here with its context, the alternatives that
were genuinely considered, and its consequences — including the bad ones. A decision without a
written trade-off is a preference, not a decision.

**Format:** context → decision → alternatives → consequences → revisit trigger.
**Statuses:** `Accepted` · `Superseded by ADR-nnnn` · `Deprecated` · `Proposed`

---

## ADR-0001 — pnpm workspaces with Turborepo

**Status:** Accepted · 2026-08-29

**Context.** Greenfield repository (audit §3A). The system needs a web app, an API, and shared
code — most importantly a shared API contract, because contract drift between frontend and backend
is the most common source of "it worked in Postman" bugs. `pnpm@11.21.0` is already installed.

**Decision.** pnpm workspaces for dependency management, Turborepo for task orchestration.

**Alternatives.**

- _Separate repositories_ — rejected: the shared contract would need publishing, and a contract
  change would span two PRs, which is exactly how drift starts.
- _npm/yarn workspaces_ — workable, but pnpm's strict `node_modules` prevents phantom
  dependencies, which is precisely the mechanism by which module boundaries get quietly violated.
- _Nx_ — more capable, more configuration. Turborepo covers caching and the task graph, which is
  all this project needs.

**Consequences.** One PR changes contract, server, and client atomically. Turborepo caches builds
and tests. Cost: a monorepo learning curve, and CI must be scoped to affected packages to stay
under the 15-minute gate.

**Revisit if** the repository grows past roughly ten packages or build times exceed the gate.

---

## ADR-0002 — Modular monolith, not microservices

**Status:** Accepted · 2026-08-29

**Context.** The brief prohibits premature microservices. Independently, the domain demands
transactional guarantees across what would be service boundaries: an approval action, a budget
movement, and an audit event must commit together or not at all.

**Decision.** One deployable, internally partitioned into domain modules with mechanically
enforced boundaries, sharing one database and one transaction scope. API and workers are the same
artefact with different entrypoints.

**Alternatives.**

- _Microservices_ — rejected: would replace a single `BEGIN…COMMIT` with sagas and compensating
  transactions for the system's most correctness-critical operation, in exchange for scaling and
  release independence that a single team at this scale does not need.
- _Layered monolith (controllers/services/repositories by type)_ — rejected: technical layering
  hides domain coupling and produces the "giant service class" the brief names as an anti-pattern.

**Consequences.** Atomic financial operations are trivial. One deploy, one log stream, one
database. Boundaries must be enforced by tooling rather than by process boundaries — so
`eslint-plugin-boundaries` and restricted imports are not optional. Everything scales together.

**Revisit if** a module needs independent scaling or release cadence _and_ its boundary has been
stable for two quarters.

---

## ADR-0003 — Prisma over Drizzle

**Status:** Accepted · 2026-08-29

**Context.** A financial schema needs rigorous migrations, exact decimal handling, and — most
importantly — a way to make tenant scoping a property of the data-access layer rather than a
habit developers must remember.

**Decision.** Prisma 6, with `$queryRaw` tagged templates for reporting aggregates.

**Alternatives.**

- _Drizzle_ — lighter, closer to SQL, excellent inference. Rejected on two grounds: a less mature
  drift-detection and rollback story, and no equivalent of client extensions for globally
  injecting the tenant predicate. That second point is decisive — it is what turns INV-01 from a
  convention into a structural property.
- _TypeORM / Sequelize_ — weaker type safety, weaker migration tooling.
- _Raw SQL + a migration runner_ — maximum control, but every query becomes a place to forget
  `organization_id`.

**Consequences.** Strong migration tooling; `Decimal` end to end for `NUMERIC`; tenant scoping
enforced centrally and failing closed. Costs: a heavier runtime (acceptable server-side), and
Prisma's query builder is insufficient for reporting aggregates — which is why those are explicit,
reviewed SQL, arguably an improvement.

**Revisit if** Prisma's aggregate limitations begin to affect non-reporting code paths.

---

## ADR-0004 — `NUMERIC(20,4)` plus explicit currency; money never a JS number

**Status:** Accepted · 2026-08-29

**Context.** Floating-point representation error is not a theoretical concern in a spend system —
`0.1 + 0.2 !== 0.3` becomes a reconciliation failure that someone has to explain to an auditor.

**Decision.** Money is `NUMERIC(20,4)` in PostgreSQL, `Prisma.Decimal` in the ORM, a `Money` value
object (decimal.js) in the domain, and a **string with an explicit currency** in JSON. Every
monetary column has a companion currency column. Rounding is half-to-even at 2 decimal places for
settlement, with 4 retained internally. Amounts of different currencies are never summed.

**Alternatives.**

- _Integer minor units_ — also correct and used successfully elsewhere. Rejected because currencies
  have differing minor-unit counts (JPY 0, KWD 3), which pushes exponent handling into every call
  site, and because `NUMERIC` keeps the database itself readable and directly queryable by an
  analyst.
- _Floating point_ — never.

**Consequences.** Exact arithmetic; database-level precision guarantees; JSON that cannot be
silently corrupted by a parser. Costs: `Money.add()` instead of `+`, a lint rule to enforce it, and
string handling in forms. Four decimals accommodates unit prices and FX without loss.

---

## ADR-0005 — Opaque database-backed sessions, not stateless JWT

**Status:** Accepted · 2026-08-29

**Context.** The requirement is explicit: session revocation. Deactivating an employee must stop
them spending money _now_, not when a token expires.

**Decision.** 32 random bytes, SHA-256 hashed in `sessions`, delivered as an `httpOnly` `Secure`
`SameSite=Lax` cookie. Idle expiry 30 minutes, absolute 12 hours. Revocable individually or
wholesale. An `IdentityProvider` port allows OIDC/SAML later without touching this.

**Alternatives.**

- _Stateless JWT_ — rejected: cannot be revoked before expiry, which is disqualifying here.
- _JWT + a revocation list_ — reintroduces the database lookup JWTs exist to avoid, while keeping
  their complexity and their key-rotation burden.

**Consequences.** Immediate revocation; sessions visible and manageable by users and admins; a
stolen database yields no usable token; no JWT key rotation problem. Cost: one indexed lookup per
request (sub-millisecond, and cacheable), and session state must be shared — which it is, in
PostgreSQL, so the API remains horizontally scalable without sticky sessions.

---

## ADR-0006 — `QueuePort` with inline and BullMQ adapters

**Status:** Accepted · 2026-08-29

**Context.** The audit found **no Redis, no Docker, and no WSL** on the development host (P3).
Writing directly against BullMQ would make the codebase undevelopable there and would make CI
require a Redis service for every unit test.

**Decision.** A `QueuePort` interface. `InlineQueueAdapter` (in-process, executes after the
current transaction commits) for local development and tests; `BullMqQueueAdapter` for staging and
production. Selected by the presence of `REDIS_URL`. **A production environment without
`REDIS_URL` fails startup.** Importing `bullmq` outside the adapter is a lint error.

**Alternatives.**

- _Require Docker locally_ — rejected: it is not installed, cannot be assumed, and would block
  development on the actual host.
- _PostgreSQL-backed queue (pg-boss)_ — one less dependency and genuinely tempting; rejected
  because job throughput would compete with transactional workload on the primary, and BullMQ's
  operational tooling is materially better.
- _Direct BullMQ everywhere_ — rejected per the context.

**Consequences.** Development works with zero extra infrastructure. Tests are deterministic —
inline execution means no polling or sleeping. Costs: two adapters to maintain, and a real
behavioural difference (in-process versus distributed) that is mitigated by running the shared
contract suite against both and by exercising BullMQ in CI.

---

## ADR-0007 — Docker optional locally, required in CI and staging

**Status:** Accepted · 2026-08-29

**Context.** No Docker on the development host (audit P4), but reproducible CI and
production-parity staging still require containers.

**Decision.** `infra/docker-compose.yml` provides PostgreSQL, Redis, MinIO, and Mailpit for
developers who have Docker, and is what CI uses. The **native path is fully supported and
documented as primary**: native PostgreSQL plus the inline queue and filesystem storage adapters.

**Consequences.** Nobody is blocked on installing Docker. CI stays reproducible. Cost: two
documented local paths, and the native path must keep working — enforced by the six-step setup in
NFR-OPS-004 being part of the release checklist.

---

## ADR-0008 — `DocumentProvider` port with a local signed-URL adapter

**Status:** Accepted · 2026-08-29

**Context.** No local S3 or MinIO. Receipts require private storage with signed URLs, and the
security semantics of that (expiry, signature, authorisation check) must be exercised in
development — not bolted on at deployment.

**Decision.** A `DocumentProvider` port. `S3DocumentProvider` for staging and production;
`LocalDocumentProvider` for development, storing under `.storage/` and issuing HMAC-signed,
short-TTL tokens served by an API route that re-checks authorisation on every request.
`DOCUMENT_PROVIDER=local` in production **fails startup**.

**Consequences.** Receipt handling is developed and tested with production security semantics.
Cost: an adapter to maintain, kept honest by the shared per-port contract suite.

---

## ADR-0009 — Web on `:3100`, API on `:4100`

**Status:** Accepted · 2026-08-29

**Context.** Ports `3000` and `5433` are occupied by unrelated Node processes on the development
host (audit P2). Next.js defaults to `3000` and would collide immediately.

**Decision.** Web `3100`, API `4100`, both environment-driven. Optional Docker services use
non-default ports (Redis `6479`, MinIO `9100/9101`, Mailpit `8125`) to avoid the same class of
collision.

**Consequences.** No collision on this host; no hard-coded ports anywhere.

---

## ADR-0010 — Tenant isolation in four layers

**Status:** Accepted · 2026-08-29

**Context.** Cross-tenant data access is the highest-severity risk in a multi-tenant finance
system (THR-01). A single control is a single point of failure, and two controls that both live in
the application share a failure mode.

**Decision.** Four layers: (0) composite foreign keys carrying `organization_id`, making a
cross-tenant reference physically impossible; (1) organisation resolved only from the session's
membership, with client-supplied values rejected; (2) a Prisma client extension injecting the
predicate and **throwing** when context is absent; (3) PostgreSQL RLS from Phase 6. Cross-tenant
access returns `404`, never `403`.

**Why RLS is Phase 6, not Phase 1.** If RLS were the first line of defence, a missing `SET` would
silently return zero rows and present as a data bug rather than a security failure — training
developers to distrust it. It is added once layers 0–2 are proven, as the layer that survives an
application defect.

**Consequences.** Multiple independent failures would be required to leak data. Costs: some
complexity in the Prisma extension, and a small RLS overhead. Failing closed on missing context
means a job that forgets to establish a request context breaks loudly — which is the intent.

---

## ADR-0011 — Policy as versioned data with a pure evaluator

**Status:** Accepted · 2026-08-29

**Context.** Approval rules change frequently, differ per customer, and must be explainable months
later. Encoding them as conditionals guarantees divergence between spend types and makes "why was
this approved in March?" unanswerable.

**Decision.** Policies are rows with versioned, immutable rule sets. Evaluation is a pure function
over an explicit context. The resulting decision — verdict, matched rule IDs, policy version IDs,
and engine version — is snapshotted onto the record. One engine serves all five spend types.

**Alternatives.**

- _Hard-coded rules_ — rejected; the brief names it as an anti-pattern and it is the root cause of
  every problem above.
- _An embedded scripting language (JS sandbox, CEL, Rego)_ — more expressive, but unbounded
  execution, a security surface, and rules that cannot be rendered as a UI form or explained to a
  non-engineer. Rejected.
- _A rules-engine library_ — heavier and less controllable than a closed field/operator set that
  can be exhaustively tested.

**Consequences.** Rules change without deploying. Decisions are reproducible and explainable.
History is stable because versions are immutable. Costs: a constrained expression vocabulary — a
genuinely novel rule needs a new field or operator, which is a deliberate, reviewed change rather
than an ad-hoc script.

---

## ADR-0012 — Immutable financial records with adjustment-based correction

**Status:** Accepted · 2026-08-29

**Context.** Editing a posted amount destroys the audit trail and makes reconciliation impossible.

**Decision.** Posted amounts, currencies, and dates are immutable, enforced by a database trigger
in addition to application state machines. Corrections are new linked records — transaction
adjustments, credit notes, budget movements. Append-only ledgers (`budget_movements`,
`approval_actions`, `audit_events`) hold no `UPDATE` or `DELETE` grant.

**Consequences.** Complete, defensible history; standard accounting practice; reconciliation is
possible. Costs: more rows, and corrections require an explicit UI affordance rather than an edit
field — which is the correct experience anyway, because it forces the user to state _why_.

---

## ADR-0013 — Server-side authorisation and computation, always

**Status:** Accepted · 2026-08-29

**Context.** Any client-supplied total, status, or permission decision is attacker-controlled.

**Decision.** Permissions, scope, totals, policy verdicts, and state transitions are decided
server-side. Request DTOs **do not contain** computed totals, statuses, approver lists, or
organisation IDs — the fields simply do not exist. The frontend's permission set drives rendering
only. A lint rule forbids money arithmetic in `apps/web`.

**Consequences.** The vulnerability class is structurally absent rather than defended against.
Cost: an extra round trip for policy preview (mitigated by the dry-run endpoint) and some
duplicated validation for user experience — where the server's answer is always the one that
counts.

---

## ADR-0014 — Providers behind ports, sandboxes labelled honestly

**Status:** Accepted · 2026-08-29

**Context.** Real card issuing and payment rails require licensed partners and a compliance
review. The product must be buildable and demonstrable before that, without ever implying money
moved when it did not.

**Decision.** Every external system sits behind a port. MVP adapters are mock, manual, CSV, and
no-op. Every adapter declares `isSandbox`, which propagates into API responses and visible UI
badges. Records created by a mock provider store `provider = 'MOCK'` permanently. Real rails are
gated on a written partner and regulatory decision, not on engineering readiness.

**Consequences.** The full domain is built and tested without external dependencies; providers are
swappable; nobody can mistake a demo configuration for a live one. Cost: honest labelling may
complicate a sales demonstration — which is the correct trade for a financial product.

---

## ADR-0015 — REST, not GraphQL

**Status:** Accepted · 2026-08-29

**Context.** The API serves one first-party web client now and third-party integrators later.

**Decision.** REST with `/v1` versioning; OpenAPI generated from `packages/contracts`.

**Alternatives.** _GraphQL_ — attractive for a table-heavy client, but authorisation must be
enforced per field rather than per endpoint (a much larger surface to get right), query cost
control is a project in itself, and integrators expect REST. _tRPC_ — excellent for a
TypeScript-only monorepo, but forecloses third-party integration, which is a stated Phase 7 goal.

**Consequences.** Simple, cacheable, testable, integrator-friendly. Cost: some over-fetching,
addressed with field selection where it measurably matters.

---

## ADR-0016 — Audit events written inside the business transaction

**Status:** Accepted · 2026-08-29

**Context.** An audit log that can silently miss events is worse than none, because it is trusted.

**Decision.** `AuditService.record()` writes through the caller's transaction handle. The event
and the change commit together or roll back together. `audit_events` has a `CHECK` requiring an
actor for user-initiated actions, and the application role holds only `INSERT` and `SELECT`.

**Alternatives.** _Asynchronous audit via the queue_ — better write performance, but a queue
failure loses history invisibly. _Database triggers_ — capture the change but not the actor's
intent, the correlation ID, or the business meaning of the action.

**Consequences.** The audit trail is provably complete. Cost: one extra insert per mutation
(negligible), and every service must have the transaction handle in scope — which good design
requires anyway.

---

## Open questions

Business decisions, not engineering ones. Each needs an owner and a date.

| #     | Question                                                                             | Needed by   | Impact if unresolved                              |
| ----- | ------------------------------------------------------------------------------------ | ----------- | ------------------------------------------------- |
| OQ-01 | Which card issuing partner, and in which jurisdictions?                              | Phase 6     | Blocks Phase 7 card work                          |
| OQ-02 | Which accounting system does the pilot customer use?                                 | Phase 6     | Determines the first real `AccountingProvider`    |
| OQ-03 | Is multi-currency consolidation required for the pilot, or is per-entity sufficient? | Phase 4     | Affects reporting design                          |
| OQ-04 | What is the data residency requirement?                                              | Phase 6     | Affects hosting region and topology               |
| OQ-05 | Is SOC 2 pursuit planned, and on what timeline?                                      | Post-pilot  | Affects logging retention and evidence collection |
| OQ-06 | Is Slack/Teams approval notification required for the pilot?                         | Phase 4     | Affects `NotificationProvider` adapters           |
| OQ-07 | What PostgreSQL credentials should the application use locally? (audit P1)           | **Phase 1** | Blocks running migrations                         |

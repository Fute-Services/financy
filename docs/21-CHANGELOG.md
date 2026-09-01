# 21 — Changelog

All notable changes to Financy are recorded here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Until `1.0.0`, the product is pre-release: the API surface may change between minor versions, and
`/v1` stability guarantees begin at `1.0.0`.

---

## [Unreleased]

### Added

- **The invitation acceptance screen** at `/invite/{token}` (task 1.7.6), and the one-time link
  surfaced in the invite dialog so there is something to send. The preview is fetched on the
  server before anything renders — asking somebody to choose a password and only then telling them
  the link expired is the sequence this avoids — and it decides whether a password is asked for at
  all: an address that already has an account must not have its password set by whoever holds an
  invitation to a different organisation. Every way a token can fail gets the same page, because
  the API answers all four the same way. The invite dialog is the one dialog that does not close
  on success: the token exists in that response and is stored hashed, so closing would throw away
  something unrecoverable.
- **The people screen writes.** Invite with a preview of what the role grants, change a role
  behind step-up, deactivate, reactivate, and resend or revoke a pending invitation (task 1.7.7).
  The role dialog collects the new role, the mandatory reason, and the password in one submission:
  the API refuses without step-up, and asking for the password as a separate first step would
  leave a window in which the person is re-authenticated and has not yet decided. The caller's own
  row shows "You" rather than two controls that would only ever answer `403`. `personSchema` now
  carries `version`, so acting from a row does not need a detail fetch per row.
- **The settings screen writes.** The organisation form, entity create/edit/archive, and the
  department tree with re-parenting all save through server actions (task 1.7.8). Every form
  carries the record version it was rendered with in a hidden input — the version the person
  actually looked at, which is what `If-Match` is supposed to assert; reading it fresh at submit
  time would defeat the precondition by construction. A stale save offers a reload rather than a
  retry, because retrying with the same version fails identically. New primitives: `Input`,
  `Select`, `Textarea`, `Dialog`, `FormMessage`.
- **The first settings writes** — `PATCH /v1/organization` (task 1.5.1) and the entity endpoints
  `GET/POST /v1/entities`, `GET/PATCH /v1/entities/{id}`, and
  `POST /v1/entities/{id}/archive`·`/restore` (task 1.5.2). Every write takes `If-Match` carrying
  the record `version`, compares it, and then repeats it in the `where` clause so the database
  makes the same check atomically; the change and its audit event commit in one transaction or
  neither does. `organizationSummarySchema` now carries `version`, because a screen with no
  version to send has no precondition to make.
- **Invitations** — `/v1/memberships/invitations` for issuing, listing, resending, and revoking,
  plus the two public halves at `/v1/auth/invitations` (task 1.5.6). The token is stored as a hash
  and returned exactly once; every failure to resolve one — unknown, spent, revoked, expired —
  answers an identical `404`, because distinguishing them tells somebody guessing which guesses
  were close. Accepting refuses a password when the address already has an account: without that,
  "invite a colleague" is a way to set the password of an account somebody else controls.
- **Membership writes** — `/v1/memberships` with `role`, `deactivate`, and `reactivate` as
  separate endpoints (tasks 1.5.5 and 1.5.7). The role is not a field on the `PATCH`: it needs
  step-up re-authentication, refuses self-elevation and the demotion of the last administrator,
  and writes a security event alongside the audit event, and folding it in would make every one of
  those a conditional inside a handler that mostly does something else. Deactivation revokes every
  session behind the membership and clears any department it headed.
- **Session management for another member** — `GET`/`DELETE /v1/memberships/{id}/sessions`
  (task 1.5.8). The list names every live session the _account_ holds, not only the ones bound to
  this organisation: one account can be signed into several, and showing a filtered list would
  make "revoke everything" look like it had worked when it had not. Revoking requires step-up and
  leaves the membership active — "sign them out of everything" is what somebody who has lost a
  laptop needs, and it is not the same request as removing their access.
- **`POST /v1/auth/step-up`** — re-proves the password on the session already held, stamping
  `steppedUpAt`. Without it `@RequireStepUp()` was a permanent `403`: nothing else set that field,
  so every route carrying the decorator was unreachable by anyone. A failure counts towards the
  same lockout as a failed login and records a `STEP_UP_FAILED` event.
- **The department tree** — `GET/POST /v1/departments`, `GET/PATCH /v1/departments/{id}`, and
  `POST /v1/departments/{id}/archive`·`/restore` (task 1.5.3). Moving a node rewrites the `path`
  of its whole subtree in the same transaction as the move; a cycle is refused by one path
  comparison before anything is written; names are unique among siblings rather than across the
  organisation, and codes across the organisation but only when set. `pathUnder()` and
  `isWithinSubtree()` live in `@financy/contracts` so the server that writes a path and any client
  that re-derives one after a local edit cannot disagree about its shape.
- **Projects and categories** — `/v1/projects` (with `close`·`reopen` as well as
  `archive`·`restore`) and `/v1/categories` (task 1.5.4). A project's `entityId` and
  `departmentId` are validated against the caller's own organisation, because the composite
  foreign key that used to make a cross-tenant reference impossible does not exist on MongoDB. A
  category's `key` is create-only and its parent is immutable: policies name the key, and moving a
  category between branches changes what every transaction already coded to it appears to have
  been. System categories may be archived, never renamed — a later deploy reseeds by key.
- **Audit export, per-record history, and the security log** — `GET /v1/audit-events/export`,
  `GET /v1/audit-events/{resourceType}/{resourceId}`, and `GET /v1/security-events`
  (tasks 1.6.2–1.6.4). The export writes an audit event describing itself — the filters and the
  row count, never the rows — because a complete copy of the trail leaving the system is the one
  act whose absence from the record would matter most. CSV fields are guarded against formula
  injection: a cell beginning `=`, `+`, `-`, or `@` is executed by Excel and Sheets on open, and
  an export is a document written by one person and trusted by another. History is chronological
  and unpaginated; the list stays newest-first and cursored, because the two answer different
  questions.
- **`@IfMatch()`** (`platform/concurrency`) — the precondition is a header rather than a body
  field, and it is mandatory: an optional one is a client that forgets, and the lost edit it
  prevents is invisible when it happens.
- **Three error codes**, because the nearest existing one was `INVALID_STATE_TRANSITION` and it
  was a lie in each case — nothing transitions when a name collides. `DUPLICATE_NAME` names the
  offending field so a form can put the message under the input; `ARCHIVED_RECORD_IMMUTABLE` says
  restore-then-edit rather than refusing without a route forward; `LAST_ACTIVE_ENTITY` mirrors
  `LAST_ADMIN` — an organisation with no active entity can be logged into and can record no spend
  at all, a dead end reachable by one button click.
- `apps/api/test/settings-writes.e2e.spec.ts` — thirteen end-to-end tests covering the three
  properties no unit test can show: that two saves from the same version leave the _first_
  writer's value in place, that the audit event commits with its change and names only the fields
  that moved, and that a cross-tenant `PATCH` is a `404` rather than a `403`.
- **People, Settings, and the Audit log** — the three screens that finish Phase 1. Each reads a
  live endpoint (`GET /v1/memberships`, `GET /v1/organization`, `GET /v1/audit-events`), enforces its
  permission at the route as well as in the navigation, and shows the caller's own organisation
  and nobody else's. `BUILT_PHASES` is raised from `0` to `1`, so the shell stops marking them
  unbuilt. All three are read-only until task 1.5 adds the writes with the concurrency control and
  audit events they need.
- The audit endpoint has no `POST` and no `DELETE`, permanently. An endpoint that accepted an
  audit event would accept a false one, and a trail somebody can prune is not evidence.
- `packages/db/test/enum-parity.test.ts` — asserts the contract's hand-written enums match the
  Prisma ones. `@financy/contracts` compiles into the browser and cannot import Prisma, so it
  restates every enum; this package can see both. The first draft of `people.ts` wrote
  `ORGANIZATION` where the schema says `ORGANISATION` and gave `MembershipStatus` four values
  where it has two — both typechecked perfectly.

### Changed

- **`GET /v1/people` is now `GET /v1/memberships`.** The specification named the second; the first
  shipped by accident. One endpoint with two names is a drift that only widens, so the old name is
  gone rather than aliased — one line in the web app. The browser route stays `/people`, because
  that is the screen's name and nothing about the URL bar is part of the API contract.
- **The database is MongoDB Atlas, temporarily** (ADR-0017). PostgreSQL remains the design and
  the documents still describe it; no PostgreSQL was reachable on the development host, and the
  alternative was blocking Phase 1 entirely. Composite foreign keys, `CHECK` constraints,
  `citext`, migrations, and the `REVOKE` that made the audit trail immutable are all gone —
  every one of those guarantees now rests on application code. The thirteen constraint tests that
  proved them are **inverted rather than deleted**, so the loss is recorded in executable form.
  Tenant isolation is now enforced in one layer instead of two; treat it accordingly.

### Removed

- **The "you may not grant a role holding permissions you lack" check** (docs/12 THR-02). It was
  written, and the end-to-end suite refuted it on the first real promotion: this catalogue is
  deliberately not nested — `ORG_ADMIN` administers people and structure and holds neither
  `approval:act` nor `transaction:categorize`, because `FINANCE_ADMIN` does. A superset check
  therefore refuses `ORG_ADMIN` the right to assign _any_ role, including `EMPLOYEE`, which makes
  the only role that can call the endpoint unable to call it. The reasoning is left in the code so
  nobody re-adds it from the threat model alone; the residual risk it aimed at needs dual control,
  which is Phase 2.

### Fixed

- **Registration returned `500` under any parallelism.** Prisma's default interactive-transaction
  timeout is five seconds, and registration is one transaction writing an organisation, five roles,
  185 grants, a user, a membership, an entity, and 36 categories against a remote database — ~3
  seconds idle, more than five whenever anything else runs. Two browser tests at once were enough
  to fail every one of them with "Transaction already closed". `transactionOptions` now allows
  twenty seconds; the round trips are the cost here, not the work.
- **Three form inputs shared one DOM id.** The field components used `name` as the id, which was
  fine until a page held more than one form — the settings screen has three, each with a field
  called `name`. Duplicate ids are invalid HTML, and the visible symptom is worse: `<label for>`
  binds to whichever came first, so clicking a label focuses a box in a different form and a
  screen reader announces the wrong field. Ids come from `useId()` now.
- **A dialog stayed open after its second successful save.** The close effect keyed on
  `state.status`, which was already `'success'` from the previous submission, so it never re-ran —
  the record was written and the form looked like it had failed. Dialogs mount only while open, so
  each opening starts from the idle state.
- **Account lockout did not exist, and failed sign-ins were never recorded.** The whole login flow
  ran in one transaction with the failure bookkeeping inside it and a `throw` on the next line;
  the throw rolled the transaction back and discarded the record. So `failedLoginCount` never
  persisted, `MAX_FAILED_LOGINS` was never reached, and the lockout in `docs/12 §3.2` was absent —
  as was every `LOGIN_FAILED` security event, which is the single signal that log exists for.
  Nothing about the response differed either way, so nothing showed it; the first test of the new
  security-events endpoint did. `POST /v1/auth/step-up`, written a day earlier, had inherited the
  same shape. Both now verify outside a transaction and commit the failure record in one of its
  own, with a regression test asserting the counter climbs across three requests.
- **An update body of `{ field: undefined }` counted as a change.** The "at least one field" rule
  counted keys, and a key set to `undefined` carries no instruction — the services skip it — so the
  request wrote nothing, incremented the version anyway, and invalidated every other client's
  `If-Match`. JSON cannot express it; a client assembling the body in TypeScript
  (`{ legalName: form.legalName || undefined }`) produces it constantly. The rule counts defined
  values now, and a contract test says so.
- **A bare `organization.findFirst()` returned another tenant's organisation.** `Organization` is
  a global model in the tenant registry — scoping the tenant by its own id would be circular — so
  the extension adds no predicate and the caller must supply one. Caught by the end-to-end suite,
  not by review.
- **`where: { archivedAt: null }` silently returned nothing**, emptying the entities and
  departments tables, for the same reason logout once failed: on MongoDB an optional field that
  was never written is absent, not null. Filtered in the application instead.
- `membership.groupBy({ _count: { _all: true } })` makes Prisma's MongoDB query engine panic. The
  aggregation runs in the application now.

- **Logout did not end the session.** `updateMany({ where: { revokedAt: null } })` matches zero
  documents on MongoDB, where an optional field that was never written is _absent_ rather than
  null. The endpoint returned `204` and the session stayed fully usable. Revocation now reads
  and writes by primary key, with unit and integration regression tests. The same code was
  correct against PostgreSQL, which is what made it dangerous.
- **`enterWith` does not survive an `await`.** The request context was lost after the first
  asynchronous boundary, so `GET /auth/session` returned `401` immediately after a successful
  login — and would have silently broken tenant scoping in Phase 2. The store object is now
  mutated in place.
- **Role provisioning expired its own transaction.** 185 grants were written as 185 `create`
  calls, which is 185 round trips to a remote database and over five seconds. One `createMany`
  now. The loop finished instantly against a local PostgreSQL, which is how it survived review.
- Compiled `.js` and `.d.ts` files had been committed beside their sources in
  `packages/db/test`, breaking lint. Removed, and the pattern is gitignored; the tsconfig that
  scattered them is marked `noEmit`.

### Testing

- Vitest and Playwright timeouts raised, and Playwright capped at two workers. Registration
  writes an organisation, five roles, 185 grants, a user, a membership, an entity, and 36
  categories in one transaction: ~140ms against a local database, ~3s across the internet. The
  tests were not wrong; the database moved.

---

## [Phase 0]

Phase 0 — foundation. A clean clone installs, lints, typechecks, tests, and builds. No product
code: everything here is the scaffolding the product is built on, and every piece of it is the
mechanised form of a rule the documentation already states.

### Added

**Workspace**

- pnpm workspace and Turborepo pipeline over `apps/*`, `packages/*`, and `tests` (P0-01).
- `packages/config` — shared tsconfig bases (`strict`, `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`), ESLint flat configs, and a Vitest base (P0-03).
- Architecture lint rules (P0-04): `@prisma/client` importable only by `@financy/db`, `bullmq`
  only by the queue adapter, no deep imports across module boundaries, and no money arithmetic in
  the browser. Each carries the guarantee it protects in its own error message.

**Domain and contract**

- `packages/core` — `Money`, `Result`, the error taxonomy, UUID v7 ids, period helpers, and a
  state-machine helper. Zero I/O, 100% coverage (P0-05).
- `packages/contracts` — the shared API contract in executable form (P0-06): response envelopes,
  the error-code-to-status map derived from the taxonomy so the two cannot diverge, cursor and
  offset pagination, strict query filters that reject an unknown parameter rather than ignoring
  it, and money as a string with `z.number()` deliberately absent.

**Data access**

- `packages/db` — Prisma initialisation, a client factory, and the tenant client extension
  (P0-07). The scoping rules are a pure function, so every operation and every fail-closed path is
  tested without a database. Models are classified as tenant-scoped or global in an explicit
  registry; an unregistered model is refused at query time, and an architecture test reads the
  generated client to assert none is missing.

**API**

- `apps/api` — NestJS bootstrap with `/v1`, Helmet, an explicit CORS origin list, a body limit, and
  graceful shutdown (P0-08).
- Startup configuration validation. A misconfigured process refuses to start and reports every
  problem at once — including Redis absent in production (ADR-0006), the local document provider in
  production (ADR-0008), a `.env.example` placeholder secret, two secrets sharing a value, and a
  connection string using the `postgres` superuser (audit P1).
- Request context via `AsyncLocalStorage`, carrying the correlation id and, from Phase 1, the
  organisation. A client-supplied `X-Correlation-Id` is adopted when well-formed and replaced when
  not.
- A global exception filter: one error envelope for every failure, a stable code, a correlation id
  in both the body and the header, and no internal detail in any response.
- `ZodValidationPipe` over `packages/contracts`, so a request body is normalised as well as
  validated and an unknown key is rejected.
- Structured Pino logging with path-based redaction, explicit request and response serialisers,
  health probes excluded from the access log, and 4xx separated from 5xx by level.
- `GET /v1/health/live` and `GET /v1/health/ready`. Liveness touches nothing; readiness probes the
  database with a timeout and returns `503` only when a required dependency is down.

**Testing and delivery**

- Test harness (P0-11): per-package Vitest projects with their own coverage floors, SWC configured
  so NestJS dependency injection works under Vitest, a Supertest suite that boots the real
  application, and a Playwright project in `tests/` that starts the whole stack itself.
- CI workflow (P0-12): lint, typecheck, format, build, tests with coverage against a real
  PostgreSQL, end-to-end, dependency audit, and secret scanning.
- `infra/docker-compose.yml` (P0-13) — PostgreSQL, Redis, MinIO, and Mailpit, with an init script
  that provisions the least-privilege role and the required extensions. Optional locally; it is
  what CI's stack mirrors.

**Phase 1 · epic 1.1 — data foundation**

- The Prisma schema for identity, tenancy, and audit: 15 models across organisations, users,
  memberships, roles, permissions, entities, departments, projects, categories, sessions, MFA
  factors, invitations, audit events, and security events (tasks 1.1.1–1.1.4).
- Cross-tenant references made structurally impossible: every tenant parent exposes
  `(id, organization_id)` and every child references it through that composite key (task 1.1.5).
- The initial migration, with the constraints Prisma cannot express appended by hand — the audit
  actor `CHECK`, ISO-4217 and ISO-3166 format checks, hierarchy and path guards, the partial unique
  index that makes a system role's key unique, and `REVOKE UPDATE, DELETE` on both immutable tables
  (task 1.1.6). **Generated but not yet applied** — see _Known gaps_.
- The permission catalogue as typed constants in `@financy/contracts`: 64 permissions, five roles,
  and the grant matrix from `docs/03 §3`, with tests asserting the invariants that document states
  — INV-05 (the auditor holds no mutating permission), the separation of configuration authority
  from transaction authority, and the absence of `audit_event:create`/`:update`/`:delete`
  (task 1.4.1, brought forward because the seed needs it).
- The default spend category tree, applied at organisation creation rather than by the system seed,
  because categories are tenant-scoped.
- The idempotent system seed (task 1.1.7). It _converges_ rather than merely avoiding duplicates: a
  permission removed from the catalogue has its grants withdrawn, so revoking a capability does not
  require a hand-written migration.
- The demo organisation seed — entities, the department tree, categories, and projects (task 1.1.8,
  partial: see _Known gaps_).

### Changed

- `correlationIdSchema` accepts any well-formed correlation id rather than only a UUID, because the
  API adopts one supplied by the web app so a single trace spans both. The pattern is shared
  between the contract and the middleware that enforces it.
- Prisma configuration moved from the `prisma` key in `package.json`, deprecated and removed in
  Prisma 7, to `prisma.config.ts`.
- `apps/web` no longer keeps its own copy of the permission matrix. It re-exports the catalogue
  from `@financy/contracts`; `src/lib/permissions.ts` now holds only the rule that the frontend
  uses permissions for rendering and never for access control.
- The `dev` script for `apps/api` runs the Nest CLI watcher rather than `tsx`. esbuild cannot emit
  `design:paramtypes`, so under `tsx` every injected dependency arrived as `undefined` and the
  failure read as a bug in the service rather than a missing compiler feature.
- `tsBuildInfoFile` moved inside `dist/` for every built package, so removing `dist` is a real
  clean. Previously a stale build-info file left `tsc` believing an emptied output directory was up
  to date, and the build silently produced only declarations.

### Fixed

- `spend_request:update` was granted to four roles by `docs/03 §3` and to none of them by the
  frontend's copy of the matrix. Both now come from one definition, and a test asserts that every
  role which can raise a spend request can also edit its own draft.
- The Overview page's build-status panel listed `packages/contracts`, `packages/db`, and `apps/api`
  as forthcoming after they had shipped.

- Sixteen integration tests against a real PostgreSQL (`packages/db/test/`), asserting that each
  hand-written constraint refuses what it exists to prevent. They skip when no database is
  configured and always run in CI, so "skipped" cannot quietly become "never runs".

**Corrected during 1.1**

- **`roles.organization_id` was specified as nullable for system roles, and that design cannot
  work.** A membership references its role through the composite key
  `(role_id, organization_id)`; a shared system role's row is `(id, NULL)` and a membership's
  organisation is never NULL, so no membership could have held a role at all. Weakening the foreign
  key was not an option — it is what makes assigning another organisation's role impossible — so
  every organisation now owns its five, provisioned at registration from the shared catalogue.
  `docs/09 §7.4a` records the reasoning. Found by the integration suite, not by review.

### Known gaps

- **The demo seed creates no people.** A membership needs a user, a user needs an argon2id hash, and
  the hasher belongs in `apps/api` with the rest of authentication (task 1.3.1) — it cannot live in
  `@financy/core`, which is compiled into the browser bundle. Seeding an account that exists and
  cannot sign in would be worse than seeding none.

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
  principles, success criteria, and an explicit statement of what Financy is _not_.
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

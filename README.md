# Financy

**Company spend management and finance operations platform.**

Financy is the control and orchestration layer for company spending: policy is enforced _before_
money is spent, evidence is captured _as_ it is spent, and reconciliation becomes a review of an
already-complete record rather than an archaeological dig.

It is deliberately **not** a bank, a card network, or a general ledger. It governs, records, and
explains spend, and integrates with the institutions and accounting systems that actually move
and book money.

---

## Documentation

`docs/` is the source of truth. Start with [`docs/README.md`](docs/README.md), which explains the
hierarchy and the change-management order.

| If you want to know…        | Read                                                                |
| --------------------------- | ------------------------------------------------------------------- |
| What the product is and why | [`01-PRODUCT-REQUIREMENTS.md`](docs/01-PRODUCT-REQUIREMENTS.md)     |
| What is in the MVP          | [`02-PRODUCT-SCOPE.md`](docs/02-PRODUCT-SCOPE.md)                   |
| Who can do what             | [`03-USER-ROLES-PERMISSIONS.md`](docs/03-USER-ROLES-PERMISSIONS.md) |
| How it is built             | [`08-ARCHITECTURE.md`](docs/08-ARCHITECTURE.md)                     |
| The data model              | [`09-DATABASE-DESIGN.md`](docs/09-DATABASE-DESIGN.md)               |
| The API contract            | [`10-API-SPECIFICATION.md`](docs/10-API-SPECIFICATION.md)           |
| How spend gets approved     | [`11-APPROVAL-POLICY-ENGINE.md`](docs/11-APPROVAL-POLICY-ENGINE.md) |
| The security model          | [`12-SECURITY-MODEL.md`](docs/12-SECURITY-MODEL.md)                 |
| When a feature is done      | [`19-DEFINITION-OF-DONE.md`](docs/19-DEFINITION-OF-DONE.md)         |
| Why a decision was made     | [`20-DECISIONS.md`](docs/20-DECISIONS.md)                           |

---

## Getting started

**Prerequisites:** Node ≥ 20.11, pnpm ≥ 9, PostgreSQL ≥ 16.
Docker is **optional** — see _Local infrastructure_ below.

```bash
pnpm install                    # 1 · install
cp .env.example .env            # 2 · configure, then set DATABASE_URL
pnpm db:migrate                 # 3 · apply migrations
pnpm db:seed                    # 4 · seed system data + a demo organisation
pnpm dev                        # 5 · web :3100 · api :4100
```

### Provisioning the database

The database is **MongoDB**, temporarily; PostgreSQL remains the design. ADR-0017 in
`docs/20-DECISIONS.md` records why, exactly which guarantees that costs, and what has to be
restored when PostgreSQL returns. Read it before trusting `docs/09-DATABASE-DESIGN.md`, which
describes the schema as designed rather than as it currently runs.

Whatever `DATABASE_URL` points at must be a **replica set**. Every write path in this
application runs inside an interactive transaction, and MongoDB has no transactions on a
standalone server. A single node is enough:

```bash
# A single-node replica set, initiated for you on startup.
docker run -d -p 27017:27017 --name financy-mongo mongodb/mongodb-atlas-local
```

```bash
# .env
DATABASE_URL=mongodb://localhost:27017/financy_dev?directConnection=true
```

Then create the collections and indexes:

```bash
pnpm db:push            # no migration history under Mongo — see ADR-0017
pnpm db:seed:system     # the permission catalogue, in every environment
pnpm db:seed:demo:full  # a demo organisation, with accounts you can sign in as
```

Never connect as the admin or root user, in any environment — create a user scoped to this
database with `readWrite` and nothing more. The config schema refuses a PostgreSQL superuser
outright, and the same rule applies here.

### Local infrastructure

Redis and S3 are **not required locally**. The reference development host has neither Docker nor
WSL ([audit finding P3/P4](docs/REPOSITORY_AUDIT.md)), so the architecture provides adapters for
exactly that case:

| Dependency           | Local                                                               | Staging / production     |
| -------------------- | ------------------------------------------------------------------- | ------------------------ |
| Queue                | `InlineQueueAdapter` — in-process, runs after commit                | BullMQ + Redis           |
| Object storage       | `LocalDocumentProvider` — filesystem with HMAC-signed expiring URLs | S3                       |
| Email                | Console outbox                                                      | SMTP / ESP               |
| Cards, payments, OCR | Mock adapters, labelled as sandbox everywhere                       | Real providers (Phase 7) |

If you _do_ have Docker, `infra/docker-compose.yml` provides PostgreSQL, Redis, MinIO, and
Mailpit. It is what CI's stack mirrors. It is never the only supported path.

```bash
docker compose -f infra/docker-compose.yml up -d
```

Its PostgreSQL publishes **5442**, not 5432, because 5432 is taken on the reference host and a
container that silently fails to bind is a worse problem than an unfamiliar port. It provisions
the `financy_app` role, both databases, and the required extensions on first start, so
`DATABASE_URL` becomes:

```text
postgresql://financy_app:financy_app@localhost:5442/financy_dev
```

### Ports

`3000` and `5433` are occupied on the reference host, so:

| Service | Port   |
| ------- | ------ |
| Web     | `3100` |
| API     | `4100` |

All ports are environment-driven.

---

## Repository layout

```text
backend/        NestJS modular monolith — HTTP and worker entrypoints, one artefact
frontend/       Next.js 15 App Router
packages/
  core/         Money, Result, errors, ids, state machines — zero I/O, zero framework
  contracts/    Zod schemas + inferred types — the shared API contract
  db/           Prisma schema, migrations, seed, tenant client extension
  ui/           Design system
  config/       tsconfig / eslint / vitest presets
docs/           Source of truth, incl. diagrams/
infra/          docker-compose, Dockerfiles
scripts/        Cross-platform maintenance scripts
tests/          Cross-cutting e2e and security suites
```

`packages/contracts` is the joint that keeps the two applications honest: one Zod schema,
validated on the server, inferred as types on the client. A contract change that breaks either
side fails the build.

---

## Commands

Start here:

```bash
npm start          # frontend + backend, ports freed first
```

`start` is the one command that should always work. It stops whatever is holding `3100` and
`4100` — including the watchers behind them, which is what actually causes the `EADDRINUSE`
you get an hour later — and then runs both applications in watch mode.

Each half starts the same way from its own directory, freeing only its own port so the other
one keeps running:

```bash
cd frontend && npm start     # http://127.0.0.1:3100
cd backend  && npm start     # http://127.0.0.1:4100
```

`npm start` runs a **watcher**, which is what you want while developing. To run the built
artefact the way production does, use `npm run start:prod` after `pnpm build`.

| Command                       | Does                                            |
| ----------------------------- | ----------------------------------------------- |
| `npm start`                   | Free the ports, then run everything in watch mode |
| `pnpm dev`                    | Run everything in watch mode, without freeing ports |
| `pnpm build`                  | Build all packages                              |
| `pnpm check`                  | Lint + typecheck + test — run before pushing    |
| `pnpm test`                   | Unit, integration, and API tests                |
| `pnpm test:coverage`          | Tests with coverage thresholds enforced         |
| `pnpm test:e2e`               | Playwright — starts the whole stack itself      |
| `pnpm lint` / `pnpm lint:fix` | ESLint                                          |
| `pnpm format`                 | Prettier                                        |
| `pnpm db:migrate`             | Apply migrations (development)                  |
| `pnpm db:studio`              | Prisma Studio                                   |
| `pnpm diagrams`               | Regenerate `docs/diagrams/*.mmd`                |
| `pnpm ports`                  | What is holding 3100 / 4100 (`--free` stops it) |
| `pnpm clean`                  | Remove build output                             |

---

## Non-negotiables

These are enforced by lint rules, tests, and database constraints — not by convention. Full list
in [`19-DEFINITION-OF-DONE.md`](docs/19-DEFINITION-OF-DONE.md).

1. **Money is never a float.** `NUMERIC(20,4)` in the database, `Money` in the domain, a **string**
   with an explicit currency on the wire. `JSON.parse` produces doubles, so a monetary JSON
   _number_ is corrupt the moment it is parsed.
2. **The server decides.** Permissions, totals, policy verdicts, and state transitions are all
   server-side. Request DTOs contain no computed totals, statuses, or organisation IDs — the
   fields do not exist.
3. **Organisation comes from the session, never from the request.** Four independent isolation
   layers; cross-tenant access returns `404`, never `403`.
4. **Posted financial records are immutable.** Enforced by a database trigger. Corrections are new
   linked records.
5. **Every financial or privileged mutation writes an audit event, in the same transaction.**
   Either both commit or neither does.
6. **Policy is data, not code.** One versioned engine serves spend requests, expenses, bills, and
   purchase orders. A second implementation is a design failure.
7. **No money arithmetic in the browser.** A lint rule enforces it.
8. **Sandbox providers are labelled as sandbox**, in the API and in the UI. We never imply money
   moved when only a record was created.

---

## Contributing

Branches: `feature/<task-id>-<slug>` · `fix/…` · `refactor/…` · `chore/…`
Commits: Conventional Commits with the task ID — `feat(auth): add scope predicate builder [1.4.3]`

Every pull request must satisfy [`19-DEFINITION-OF-DONE.md`](docs/19-DEFINITION-OF-DONE.md).
Documentation is updated in the same PR as the behaviour it describes; drift is treated as a bug.

**Never commit** `.env`, secrets, API keys, or credentials. Secret scanning runs pre-commit and in
CI, but the first line of defence is not committing them.

---

## Status

Pre-release. See [`docs/21-CHANGELOG.md`](docs/21-CHANGELOG.md) and
[`docs/18-DEVELOPMENT-ROADMAP.md`](docs/18-DEVELOPMENT-ROADMAP.md).

Financy holds **no compliance certification** — not SOC 2, not PCI DSS, not ISO 27001 — and is
not a regulated financial institution.
[`07-NON-FUNCTIONAL-REQUIREMENTS.md §6`](docs/07-NON-FUNCTIONAL-REQUIREMENTS.md) describes the
engineering posture; that is a different claim and is worded as such.

# Repository Audit

- **Audit date:** 2026-08-29
- **Repository:** `C:\Users\FS165\financy`
- **Remote:** `https://github.com/Fute-Services/financy.git`
- **Auditor:** Engineering lead (initial baseline audit)
- **Status:** Complete — findings below drive `docs/08-ARCHITECTURE.md` and `docs/17-DEPLOYMENT.md`

---

## 1. Executive summary

The repository is **empty**. It contains an initialised `.git` directory with a configured
GitHub remote and **zero commits on `main`**. There is no source code, no package manifest,
no lockfile, no configuration, and no documentation.

This is a **greenfield build**. There is no legacy code to preserve, no migration risk, and no
reusable component. Every architectural decision is open, which means every architectural
decision must be *made deliberately and recorded*, not defaulted into.

The local machine is **partially provisioned**: a modern Node toolchain and a running
PostgreSQL 18 server are present, but **Redis, Docker, and WSL are absent**. This is the single
most consequential environmental finding and it directly shapes the local development strategy
(see §6 and ADR-0006).

---

## 2. Audit method

Each item below was checked directly rather than assumed.

| Area | Command / probe | Result |
|---|---|---|
| Filesystem | `ls -la` at repo root | Only `.git` |
| Git history | `git log --oneline` | `fatal: ... does not have any commits yet` |
| Branches | `git branch -a` | None (unborn `main`) |
| Remote | `git remote -v` | `origin` to `Fute-Services/financy` |
| Working tree | `git status --short` | Clean / empty |
| Package manifest | `package.json` search | Absent |
| Lockfiles | `pnpm-lock.yaml`, `package-lock.json`, `yarn.lock` | Absent |
| Env files | `.env*` | Absent |
| TS config | `tsconfig*.json` | Absent |
| Lint / format | `.eslintrc*`, `eslint.config.*`, `.prettierrc*` | Absent |
| Test config | `jest.config.*`, `vitest.config.*`, `playwright.config.*` | Absent |
| Docker | `Dockerfile`, `docker-compose*`, `docker --version` | Absent (both file and binary) |
| CI | `.github/workflows` | Absent |
| Docs | `docs/`, `README.md` | Absent |

---

## 3. Answers to the required audit questions

| # | Question | Answer |
|---|---|---|
| A | Is this a blank repository? | **Yes.** Unborn `main`, zero commits, `.git` only. |
| B | Is a frontend already present? | **No.** |
| C | Is a backend already present? | **No.** |
| D | Is a monorepo already present? | **No.** No workspace config of any kind. |
| E | What package manager is being used? | **None yet.** `pnpm@11.21.0`, `npm@11.6.2`, `yarn@1.22.22` (via Corepack) are all available. **pnpm is selected** — see ADR-0001. |
| F | What architecture currently exists? | **None.** Greenfield. |
| G | What can be reused safely? | **Nothing in-repo.** Reusable *environment* assets only: the running PostgreSQL 18 instance and the Node 24 toolchain. |
| H | What needs to be created? | **Everything** — see §7. |

> The instruction "do not delete or rewrite working code just because you prefer another
> structure" is trivially satisfied: there is no existing code. No destructive action was taken
> and none is required.

---

## 4. Local toolchain inventory

### Present and usable

| Tool | Version | Notes |
|---|---|---|
| Node.js | `v24.11.1` | Comfortably exceeds the Next.js 15 / NestJS 11 floor. |
| npm | `11.6.2` | Available; not the chosen PM. |
| pnpm | `11.21.0` | **Selected package manager.** Workspace support, strict `node_modules`, fast CI. |
| yarn | `1.22.22` | Via Corepack shim. Not used. |
| Git | `2.52.0.windows.1` | Fine. |
| PostgreSQL | **18.1**, service `postgresql-x64-18`, **Running**, listening `0.0.0.0:5432` and `[::]:5432` | Binaries at `C:\Program Files\PostgreSQL\18\bin`. |
| Vercel CLI | `58.0.0` (global) | Signals an existing Vercel deployment habit; informs the web hosting recommendation. |
| npm registry | `PONG 337ms` | Network egress to `registry.npmjs.org` confirmed. |

### Absent

| Tool | Impact | Mitigation |
|---|---|---|
| **Redis** | BullMQ (the specified queue) requires it. No async worker tier can run locally as-specified. | `QueuePort` abstraction with an **in-process `InlineQueueAdapter`** for local dev/tests and a **`BullMqQueueAdapter`** for staging/prod. ADR-0006. |
| **Docker / Docker Desktop** | No one-command local stack. Not installed at `C:\Program Files\Docker` either. | Use the natively installed PostgreSQL. Ship `infra/docker-compose.yml` anyway for CI and for developers who *do* have Docker — it must not be the only supported path. ADR-0007. |
| **WSL** | `wsl.exe -l -v` reports not installed. No Linux-side fallback for Redis/Docker. | Same as above. Also means all local scripts must be **cross-platform** (no bash-only assumptions in `package.json` scripts). |
| **S3 / MinIO** | Receipt and document storage has no local backing store. | `DocumentProvider` port with a **local filesystem adapter** that emulates signed URLs via HMAC-signed, short-TTL tokens served by the API. ADR-0008. |

---

## 5. Problems and risks found

### P1 — PostgreSQL superuser credentials are unknown (blocking for Phase 1 runtime)

`psql -h 127.0.0.1 -p 5432 -U postgres` returns
`FATAL: password authentication failed for user "postgres"`.
`pg_hba.conf` is not readable from this shell (`Permission denied`), so the configured auth
method could not be confirmed, and no `%APPDATA%\postgresql\pgpass.conf` exists.

- **Impact:** Documentation, schema design, and code all proceed. **Running migrations cannot.**
- **Resolution required from the operator:** either supply the `postgres` password, or create a
  dedicated least-privilege role and database. The latter is preferred and is what the project
  will use regardless:

  ```sql
  CREATE ROLE financy_app WITH LOGIN PASSWORD '<generated>';
  CREATE DATABASE financy_dev  OWNER financy_app;
  CREATE DATABASE financy_test OWNER financy_app;
  ```

- **Note:** the application must **never** connect as `postgres` in any environment.

### P2 — Port 3000 is already occupied

`Get-NetTCPConnection -LocalPort 3000` resolves to PID 6408, `node.exe`. An unrelated dev server
is running. Port `5433` is likewise held by PID 15132 (`node.exe`).

- **Impact:** Next.js's default port would collide immediately.
- **Resolution:** the project standardises on **web `:3100`** and **API `:4100`** (port `4000`
  was verified free, but `4100` keeps the pair adjacent and memorable). Ports are env-driven,
  never hard-coded.

### P3 — No queue infrastructure locally

Covered in §4. The risk is *architectural*, not merely operational: if async work is written
directly against BullMQ, the codebase becomes undevelopable on this machine and untestable in
CI without a Redis service. The port/adapter split is therefore mandatory from day one, not a
later refactor.

### P4 — Windows-only development host

No WSL, no containers. Path handling, script portability, and line endings (`core.autocrlf`)
all need explicit attention.

- **Resolution:** commit a `.gitattributes` enforcing `LF` for all text; forbid shell-specific
  syntax in npm scripts; use Node-based scripts under `scripts/` for anything non-trivial.

### P5 — Empty repository has no guardrails

No `.gitignore` exists. The very first commit could leak `.env`, `node_modules`, or build output.

- **Resolution:** `.gitignore`, `.env.example`, and secret hygiene must land in the **first**
  commit, before any application code.

### P6 — Remote is a shared organisation repository

`Fute-Services/financy` is an org remote. Branch protection, review requirements, and CI status
checks are unknown from here.

- **Resolution:** work on `feature/*` branches per the stated Git workflow; do not push to `main`
  without instruction.

---

## 6. Missing infrastructure — full list

| Layer | Needed | Present? | Plan |
|---|---|---|---|
| Monorepo tooling | pnpm workspaces + Turborepo | No | Phase 0 |
| TypeScript config | Shared strict base + per-package extends | No | `packages/config` |
| Lint / format | ESLint 9 flat config, Prettier | No | `packages/config` |
| Backend framework | NestJS 11 | No | `apps/api` |
| Frontend framework | Next.js 15 App Router | No | `apps/web` |
| ORM + migrations | Prisma 6 | No | `packages/db` |
| Database | PostgreSQL 16+ | **Yes — 18.1 running** | Create app role + `financy_dev` / `financy_test` |
| Cache / queue | Redis + BullMQ | No | Port + inline adapter locally; Redis in staging/prod |
| Object storage | S3-compatible | No | Port + filesystem adapter locally; S3 in staging/prod |
| Auth | Sessions, MFA-ready, RBAC | No | First-party auth module + `IdentityProvider` port |
| Observability | OpenTelemetry, structured logs, error tracking | No | Pino + OTel SDK, wired in Phase 1 |
| Testing | Vitest, Supertest, Playwright | No | Phase 0 harness; tests from Phase 1 onward |
| CI | GitHub Actions | No | Phase 0 |
| Containerisation | Dockerfiles + compose | No | `infra/` — optional locally, required for CI/staging |
| Secrets hygiene | `.gitignore`, `.env.example` | No | First commit |

---

## 7. Recommended target structure

```text
financy/
├── apps/
│   ├── api/                  # NestJS 11 modular monolith (HTTP + worker entrypoints)
│   │   └── src/
│   │       ├── modules/      # one folder per business domain
│   │       ├── platform/     # cross-cutting: config, db, auth guards, request context,
│   │       │                 #   audit interceptor, error filter, telemetry, queue, storage
│   │       └── main.ts
│   └── web/                  # Next.js 15 App Router
│       └── src/
│           ├── app/          # route groups: (auth), (app)/<module>
│           ├── features/     # domain-facing composed UI + data hooks
│           └── lib/          # api client, session, formatting
├── packages/
│   ├── core/                 # Money, Result, domain errors, ID + enum primitives (no I/O)
│   ├── contracts/            # Zod schemas + inferred types — the shared API contract
│   ├── db/                   # Prisma schema, migrations, seed, generated client
│   ├── ui/                   # design system: primitives + finance-specific components
│   └── config/               # tsconfig / eslint / tailwind / vitest presets
├── docs/
│   └── diagrams/             # standalone .mmd sources
├── infra/                    # docker-compose, Dockerfiles, deployment manifests
├── scripts/                  # cross-platform Node maintenance scripts
└── tests/                    # cross-cutting e2e + security suites (Playwright)
```

**Why this shape**

- `apps/` vs `packages/` is the least surprising monorepo convention and maps cleanly to
  Turborepo pipelines.
- `packages/contracts` is the mechanism that stops frontend and backend from drifting: one Zod
  schema, validated on the server, inferred as types on the client. It is also how "never trust
  frontend-calculated totals" is enforced *structurally* — request DTOs simply do not carry
  computed totals.
- `packages/core` holds `Money` and the domain primitives with **no I/O dependencies**, so
  financial correctness is unit-testable in isolation.
- Backend modules are organised **by business domain**, not by technical layer, per the brief.

---

## 8. Decisions arising from this audit

Recorded formally in `docs/20-DECISIONS.md`; listed here for traceability.

| ADR | Decision | Audit driver |
|---|---|---|
| ADR-0001 | pnpm + Turborepo monorepo | §3E, greenfield |
| ADR-0002 | NestJS modular monolith | Brief; no prior backend (§3C) |
| ADR-0003 | Prisma over Drizzle | Migration rigour is non-negotiable for finance |
| ADR-0004 | `NUMERIC(20,4)` + explicit currency; money never a JS `number` | Financial rule §33 |
| ADR-0005 | Opaque DB-backed sessions, not stateless JWT | Revocation requirement |
| ADR-0006 | `QueuePort` + inline/BullMQ adapters | **P3 — no local Redis** |
| ADR-0007 | Docker optional locally, required in CI/staging | **P4 — no Docker/WSL** |
| ADR-0008 | `DocumentProvider` port + local FS signed-URL adapter | No local S3 |
| ADR-0009 | Web `:3100`, API `:4100` | **P2 — port 3000 occupied** |
| ADR-0010 | Tenant isolation in three layers (context, Prisma extension, RLS) | Security §13 |

---

## 9. Immediate next actions

1. Audit recorded (this document).
2. Author the full `docs/` set (`01`–`21`, plus design system and diagrams).
3. Phase 0: repository scaffolding, `.gitignore`, `.env.example`, CI, lint/test harness.
4. **Operator input needed:** PostgreSQL credentials per **P1** before migrations can run.
   Everything up to and including schema authoring proceeds without it.
5. Phase 1: auth, organisation, membership, RBAC, sessions, audit log, app shell, People page.

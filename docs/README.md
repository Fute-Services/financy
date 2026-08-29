# Financy — Documentation

> **Financy** is a company spend management and finance operations platform.
> This directory is the **source of truth** for the product, its architecture, and its
> implementation plan. Code that contradicts these documents is a defect in one or the other —
> reconcile it, do not ignore it.

---

## 1. Originality statement

Financy is an original product. It sits in the same product category as other corporate spend
management tools, which are used only as *category references* to understand the problem space.
No third-party branding, source code, proprietary interface, copy, trademark, or visual design
is reproduced here. The product name, information architecture, domain model, policy engine
design, API surface, and visual identity in these documents are original to this project.

---

## 2. Documentation hierarchy

Documents are ordered so that each one is justified by the one above it. When something
changes, change it at the highest affected level first, then propagate downward.

```text
Tier 0 — Baseline
  REPOSITORY_AUDIT.md ....... what existed before we started

Tier 1 — Why (product intent)
  01-PRODUCT-REQUIREMENTS.md  vision, personas, jobs-to-be-done, principles
  02-PRODUCT-SCOPE.md ....... what is in the MVP, what is deferred, what is out
  03-USER-ROLES-PERMISSIONS.md  roles and the authoritative permission matrix

Tier 2 — What (behaviour)
  04-INFORMATION-ARCHITECTURE.md  navigation, every screen, every required state
  05-USER-FLOWS.md .......... end-to-end workflows as diagrams
  06-FUNCTIONAL-REQUIREMENTS.md   numbered, testable requirements (FR-*)
  07-NON-FUNCTIONAL-REQUIREMENTS.md  performance, availability, compliance posture (NFR-*)

Tier 3 — How (technical design)
  08-ARCHITECTURE.md ........ system + module architecture
  09-DATABASE-DESIGN.md ..... ERD, tables, constraints, financial invariants
  10-API-SPECIFICATION.md ... REST contract, errors, pagination, idempotency
  11-APPROVAL-POLICY-ENGINE.md  the policy + approval subsystem
  12-SECURITY-MODEL.md ...... threat model, tenant isolation, controls
  13-INTEGRATIONS.md ........ provider ports and adapters
  14-ASYNC-JOBS.md .......... queues, workers, job catalogue
  15-REPORTING-ANALYTICS.md . reporting model and accounting dimensions
  UI-DESIGN-SYSTEM.md ....... visual language and component contracts

Tier 4 — Execution
  16-TESTING-STRATEGY.md .... test pyramid and required coverage per domain
  17-DEPLOYMENT.md .......... environments, config, release process
  18-DEVELOPMENT-ROADMAP.md . phases, epics, backlog
  19-DEFINITION-OF-DONE.md .. the completion checklist
  20-DECISIONS.md ........... ADR log
  21-CHANGELOG.md ........... what actually shipped, when
```

---

## 3. Source-of-truth rules

| Question | Authoritative document | Never authoritative |
|---|---|---|
| What does the product do? | `01`, `02`, `06` | Code comments, UI copy |
| Who may do it? | `03` (matrix), enforced in code | Frontend route guards |
| What is a screen supposed to show? | `04` | A prior screenshot |
| What shape is the data? | `09` and the Prisma schema | Any hand-written SQL |
| What shape is a request? | `10` and `packages/contracts` | A frontend fetch call |
| Is a spend allowed? | `11` and the policy engine | Any controller `if` statement |
| Is a feature done? | `19` | "The UI renders" |
| Why is it built this way? | `20` | Tribal memory |

**Conflict resolution:** if the Prisma schema and `09-DATABASE-DESIGN.md` disagree, the *schema*
is what runs, so the document is stale and must be corrected in the same pull request. The same
rule applies to `packages/contracts` versus `10-API-SPECIFICATION.md`. Documentation drift is
treated as a bug, not as housekeeping.

---

## 4. Change management

Requirement changes follow this order, without exception:

1. `01-PRODUCT-REQUIREMENTS.md` / `02-PRODUCT-SCOPE.md`
2. `03-USER-ROLES-PERMISSIONS.md` if permissions move
3. `06-FUNCTIONAL-REQUIREMENTS.md` — add or amend the numbered `FR-*`
4. `08` / `09` / `10` / `11` / `12` — architecture, schema, contract, policy, security
5. `04` / `05` — screens and flows
6. `18-DEVELOPMENT-ROADMAP.md` — reschedule the work
7. `20-DECISIONS.md` — record the decision and its alternatives
8. **Then** write code.

Silent architecture changes are prohibited.

---

## 5. Diagrams

All diagrams are Mermaid, rendered inline in the relevant document. Diagrams that are reused or
that are large enough to stand alone also live as `.mmd` sources in `docs/diagrams/`, listed in
`docs/diagrams/README.md`. A diagram is documentation, not decoration — if it no longer matches
the code, fix it.

---

## 6. Conventions used throughout

- **Money** is always written as an amount plus an ISO-4217 currency code. A bare number is
  never money.
- **`FR-###`** — functional requirement. **`NFR-###`** — non-functional requirement.
  **`ADR-####`** — architecture decision record. **`THR-##`** — threat model entry.
  These identifiers are stable and are referenced from tests.
- **Must / should / may** are used in the RFC 2119 sense.
- Phase numbering (`Phase 1`…`Phase 7`) is consistent across every document and matches
  `18-DEVELOPMENT-ROADMAP.md`.

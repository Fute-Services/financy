# 19 — Definition of Done

**Status:** Baseline v1.0 — 2026-08-29

---

## 1. The standard

> **A feature is not done because the UI renders.**

A screen that looks finished but has no permission check, no audit trail, no error state, and no
test is not 80 % done — it is a liability, because it creates the appearance of a working system.
In a finance product that appearance is actively dangerous: someone will trust a number it
produced.

A feature is done when **every applicable item below is true**. Not most. Every one.

---

## 2. The checklist

Copied into every pull request as a template. Items that genuinely do not apply are struck through
with a one-line reason — never silently dropped.

### Data
- [ ] Prisma schema updated; every new tenant-scoped table carries `organization_id`
- [ ] Composite unique key on the parent and composite FK on the child, so cross-tenant references are impossible
- [ ] Every foreign key indexed; composite indexes lead with `organization_id`
- [ ] Monetary columns are `NUMERIC(20,4)` with an explicit currency column
- [ ] `CHECK` constraints for domain invariants (non-negative amounts, currency format, enum-like text)
- [ ] Unique constraints where duplication must be **impossible**, not merely checked
- [ ] Deletion tier chosen and implemented (immutable / archive / soft)
- [ ] Migration written, reviewed, and applied cleanly to an empty database **and** to a seeded copy
- [ ] Migration is backward-compatible with the currently deployed code (expand/contract)
- [ ] Seed updated if the feature needs reference data; the system seed remains idempotent

### API
- [ ] Zod schemas in `packages/contracts` for every request and response
- [ ] Endpoint documented in `10-API-SPECIFICATION.md`
- [ ] `@RequirePermission()` (or an explicit `@Public()`) on every route
- [ ] `@Scoped()` with the correct strategy where rows are user-scoped
- [ ] `@RequireStepUp()` on high-risk actions
- [ ] `@Idempotent()` on every mutating endpoint that can be retried
- [ ] Pagination on every collection — no unbounded list
- [ ] Filters declared in the contract; an unknown filter returns `422`
- [ ] Errors use the shared taxonomy with stable codes
- [ ] Optimistic concurrency (`version` + `If-Match`) where a user can edit from a stale view
- [ ] Response contains no secret, hash, token, PAN, CVV, or encrypted blob

### Domain
- [ ] Business logic lives in a domain or application service — **not** in a controller
- [ ] State transitions go through an explicit state machine; illegal transitions throw
- [ ] Money handled by the `Money` value object; no `+`/`-`/`*` on a monetary value
- [ ] Currencies never implicitly mixed
- [ ] Totals computed server-side from persisted line items; any client-supplied total is ignored
- [ ] Posted financial values immutable; corrections are new linked records
- [ ] Multi-record financial operations are one transaction, including their audit events
- [ ] Concurrency handled where a lost update would corrupt a figure (row lock or unique index)
- [ ] Approval or policy behaviour reuses the **existing** engine — no second implementation

### Security
- [ ] Organisation resolved from the session; a client-supplied `organizationId` is rejected
- [ ] Repository queries carry the tenant predicate — no post-fetch filtering
- [ ] Cross-tenant access returns `404`, never `403`
- [ ] All input validated at the boundary; unknown keys stripped
- [ ] Uploads validated by content sniffing and served only by short-TTL signed URL
- [ ] Rate limits applied where abuse is plausible
- [ ] Applicable invariants (INV-01…INV-10) upheld and tested
- [ ] Nothing sensitive logged; redaction verified

### Audit and observability
- [ ] Every financial, permission, policy, or configuration mutation writes an audit event
- [ ] The audit event is written **in the same transaction** as the change
- [ ] The actor is recorded — a user membership, or an explicit `SYSTEM` actor with the job name
- [ ] Before/after payloads captured for updates
- [ ] Privilege changes additionally write a security event
- [ ] The record's `History` tab shows the new events correctly
- [ ] Meaningful operations emit a span and a metric
- [ ] Errors carry a correlation ID that the UI surfaces

### Frontend
- [ ] Loading state — skeleton matching the final geometry, not a spinner
- [ ] Empty state — the correct one of the three kinds (first-run / filtered / scope)
- [ ] Error state — code + correlation ID + retry
- [ ] Permission state — names the required permission; not a redirect and not a 404
- [ ] Built from `packages/ui`; no bespoke one-off styling
- [ ] **No money arithmetic anywhere in `apps/web`**
- [ ] Filters, sort, and pagination reflected in the URL
- [ ] Destructive and financial confirmations name the exact record, count, and amount
- [ ] Keyboard operable end to end; focus visible, trapped in dialogs, restored on close
- [ ] `axe` passes with no violations
- [ ] Correct in both light and dark themes
- [ ] Usable at 1280×800 without horizontal scrolling; degrades gracefully below `lg`
- [ ] All strings from the message catalogue

### Tests
- [ ] Unit tests for domain logic, including **every illegal state transition**
- [ ] Integration tests against a real database for constraints, transactions, and audit atomicity
- [ ] API tests: unauthenticated, unauthorised, out-of-scope, cross-tenant, invalid, valid, idempotent replay
- [ ] Security tests for the invariants this feature touches
- [ ] Financial correctness tests where money is involved (rounding, duplication, concurrency)
- [ ] Every new job has a **run-twice test asserting the effect happened once**
- [ ] E2E test if the feature is a user-visible journey
- [ ] Coverage floors met for the touched packages
- [ ] No test is skipped, `.only`, or quarantined without a linked issue

### Documentation
- [ ] `10-API-SPECIFICATION.md` updated
- [ ] `09-DATABASE-DESIGN.md` updated if the schema changed
- [ ] `06-FUNCTIONAL-REQUIREMENTS.md` updated or the implemented `FR-*` referenced
- [ ] `03-USER-ROLES-PERMISSIONS.md` updated if permissions changed
- [ ] `04-INFORMATION-ARCHITECTURE.md` updated if screens changed
- [ ] `14-ASYNC-JOBS.md` updated if a job was added
- [ ] An ADR added to `20-DECISIONS.md` for any non-obvious decision
- [ ] `21-CHANGELOG.md` updated
- [ ] `.env.example` updated for any new configuration

### Delivery
- [ ] Branch named `<type>/<task-id>-<slug>`
- [ ] Conventional commits referencing the task ID
- [ ] CI green: lint, typecheck, unit, integration, API, security, critical E2E, build, audit, secret scan, coverage, bundle size, architecture lint
- [ ] No secret, key, or `.env` committed — verified, not assumed
- [ ] No new dependency without a written justification in the PR
- [ ] Self-reviewed against this checklist before requesting review
- [ ] Reviewed and approved (two approvals for security, schema, or money-handling changes)

---

## 3. Definition of Ready

Work does not start until:

- [ ] The functional requirement exists and is numbered
- [ ] Acceptance criteria are written and testable
- [ ] The API contract shape is decided
- [ ] Schema changes are designed
- [ ] The required permission and scope are decided
- [ ] Test cases are listed, including the failure and denial paths
- [ ] Dependencies on other tasks are resolved
- [ ] Any ambiguity is resolved or an explicit assumption is recorded

Starting an under-specified financial feature means discovering the specification by writing the
schema — and schemas are the most expensive thing to get wrong.

---

## 4. Phase-level Definition of Done

A phase is done only when every task is done **and**:

- [ ] The phase's exit criterion from `02-PRODUCT-SCOPE.md` is demonstrated live, not described
- [ ] The full test suite passes, including nightly (performance, DAST, full E2E)
- [ ] No known critical or high security finding is open
- [ ] Performance targets for the phase's endpoints are met and benchmarked
- [ ] Every screen delivered has all four required states
- [ ] Every endpoint delivered is documented and permission-tested
- [ ] A cross-tenant fuzz run over the phase's endpoints returns no leakage
- [ ] Documentation is consistent with the code — verified by re-reading, not assumed
- [ ] `21-CHANGELOG.md` records the phase
- [ ] A short demonstration of the exit criterion is recorded

---

## 5. Explicit anti-patterns

Any of these means the work is **not** done, regardless of the checklist:

| Anti-pattern | Why it fails |
|---|---|
| A screen with no backend | It teaches users to trust something that does not exist |
| An endpoint with no permission check | One missing guard is a full breach |
| A financial mutation with no audit event | The record becomes indefensible |
| Business logic in a controller | Untestable, unreusable, and it will be duplicated |
| A second approval or policy implementation | Guaranteed divergence; the whole design exists to prevent it |
| A hard-coded dashboard number | A lie with a chart around it |
| Money as a JavaScript `number` | Silent, unrecoverable precision loss |
| A client-computed total accepted by the server | The entire authorisation model is bypassed |
| An `UPDATE` to a posted financial value | Destroys the audit trail |
| A job with no idempotency test | At-least-once delivery *will* run it twice |
| "I'll add tests later" | Later does not arrive; the tests that matter are the ones written with the code |
| "It works locally" | The three environments differ by design; that is what CI is for |
| A skipped test with no linked issue | A known failure that has been made invisible |

# Diagrams

Mermaid sources for diagrams that are reused across documents or large enough to stand alone.
Diagrams that appear once live inline in their document.

**A diagram is documentation, not decoration.** If it no longer matches the code, it is a defect —
fix it in the same pull request that changed the behaviour.

---

## Index

| # | File | Subject | Primary document |
|---|---|---|---|
| 1 | `01-product-ecosystem.mmd` | Product ecosystem — who uses Financy and what it connects to | `01` |
| 2 | `02-system-architecture.mmd` | High-level system context | `08 §2` |
| 3 | `03-request-flow.mmd` | Frontend → backend → database request pipeline | `08 §4.4` |
| 4 | `04-module-architecture.mmd` | Domain module map and dependencies | `08 §4.2` |
| 5 | `05-erd-core.mmd` | ERD — identity and tenancy | `09 §2` |
| 6 | `06-erd-spend.mmd` | ERD — policies, approvals, requests, cards | `09 §3` |
| 7 | `07-erd-financial.mmd` | ERD — transactions, receipts, expenses, budgets | `09 §4` |
| 8 | `08-erd-payables.mmd` | ERD — vendors, bills, procurement, accounting | `09 §5` |
| 9 | `09-org-hierarchy.mmd` | Organisation, entity, department, membership hierarchy | `03 §1` |
| 10 | `10-spend-request-lifecycle.mmd` | Spend request state machine | `05 §D` |
| 11 | `11-approval-engine.mmd` | Approval sequence and resolution | `05 §E`, `11 §6` |
| 12 | `12-policy-evaluation.mmd` | Policy evaluation algorithm | `05 §F`, `11 §5` |
| 13 | `13-card-lifecycle.mmd` | Card state machine | `05 §G` |
| 14 | `14-transaction-lifecycle.mmd` | Transaction state machine and its three status axes | `05 §H` |
| 15 | `15-expense-lifecycle.mmd` | Expense state machine | `05 §J` |
| 16 | `16-reimbursement-flow.mmd` | Reimbursement batching and payment | `05 §K` |
| 17 | `17-budget-lifecycle.mmd` | Budget movements and balance calculation | `05 §L` |
| 18 | `18-bill-lifecycle.mmd` | Bill / AP state machine | `05 §M` |
| 19 | `19-procurement-lifecycle.mmd` | Purchase order and three-way match | `05 §N` |
| 20 | `20-vendor-lifecycle.mmd` | Vendor state machine | `05 §O` |
| 21 | `21-accounting-export.mmd` | Accounting export and idempotent re-run | `05 §P` |
| 22 | `22-notification-jobs.mmd` | Queue and worker topology | `14 §5` |
| 23 | `23-tenant-security.mmd` | Four-layer tenant isolation | `12 §5` |
| 24 | `24-deployment.mmd` | Deployment topology | `08 §10`, `17 §7` |
| 25 | `25-vertical-slice.mmd` | The first vertical slice, end to end | `05 §0` |

---

## Conventions

- **Direction:** `TB` for hierarchy and architecture, `LR` for pipelines and sequences.
- **State machines:** `stateDiagram-v2`, with terminal states explicitly transitioning to `[*]`.
- **Every state and transition in a diagram must exist in code.** A diagram showing a state the
  state machine cannot reach is worse than no diagram.
- **Colour** is used only for meaning (pure/impure, trusted/untrusted, MVP/deferred), never for
  decoration, and never as the sole carrier of that meaning — labels always say it too.
- **No secrets, credentials, or real customer data** in any diagram.

## Rendering

Mermaid renders natively in GitHub and in most Markdown viewers. For a local export:

```bash
npx -y @mermaid-js/mermaid-cli -i docs/diagrams/05-erd-core.mmd -o out/erd-core.svg
```

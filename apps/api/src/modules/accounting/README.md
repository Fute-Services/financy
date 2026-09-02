# Accounting (Phase 6)

The chart of accounts, the rules that reach it, the export, and the close.

## What is here

| File                            | What it owns                                                        |
| ------------------------------- | ------------------------------------------------------------------- |
| `accounting-codes.service.ts`   | GL accounts, cost centres, tax codes, import, and the period close.  |
| `accounting-mapping.service.ts` | Rules from a record's dimensions to codes, and the simulator.        |
| `accounting-export.service.ts`  | Candidate selection, coding, balancing, checksum, and the batch.     |

## The three decisions worth knowing before changing anything

**The unique index on `export_batch_items` is the idempotency.** A record that
has left cannot leave again, whatever a filter says (FR-ACC-005). There is
deliberately no `exported` flag on the record itself: two copies of the same
fact disagree the first time a batch is interrupted, and the disagreement is
invisible until somebody reconciles a month by hand.

**Unmapped records are named, never defaulted** (FR-ACC-003). An export that
invents a GL account produces a clean-looking file that is wrong, and the
discovery happens in somebody else's system a quarter later.

**Mapping is first-match-by-priority**, the same shape as the policy engine, so
"which rule decided this?" is answerable from the rules rather than from the
order a database returned them in. The simulator and the export call the *same*
resolver — a harness that could disagree with the thing it models is worse than
no harness.

## What is not here

`AccountingProvider` — live sync with QuickBooks, Xero, or NetSuite — is Phase 7
and is gated on a partner decision (FR-ACC-008). The export produces a batch and
a checksum; carrying it to somebody else's ledger over an API is a different
problem with its own failure modes, and the port for it should be designed
against a real integration rather than imagined ahead of one.

# Payables (Phase 5)

Suppliers, their invoices, and the orders that precede them.

## Why one module

The three are one workflow with one duplicate-payment problem running through
it: a supplier entered twice becomes an invoice paid twice, and a purchase order
that nothing matches becomes a commitment nobody releases. Splitting them would
put the indexes that prevent both on one side of a boundary and the states they
protect on the other.

## Two duplicate problems, two different answers

**An invoice number is unique per supplier, enforced by an index.** Paying the
same invoice twice is a correctness violation with no remedy after the fact, and
two people entering it on the same afternoon both pass a pre-flight check. The
index is the control; the check exists only to produce a useful message.

**A supplier's normalised name is deliberately *not* unique.** Two suppliers
really can normalise to the same name — a franchise and its parent, the same
trading name in two countries — and a hard constraint would make the honest case
impossible to record at all. Duplication here is a data-quality problem with a
remedy (merge), so the create path refuses by default, names what it matched,
and takes an explicit override.

That asymmetry is the most load-bearing decision in this module.

## The approval engine is not reimplemented here

A bill carries `spendType = BILL` and a purchase order `PURCHASE_ORDER` into the
same evaluator and the same chain that spend requests and expenses use. Nothing
in the approvals module knows what either is. The payables suite asserts it by
reading a bill's chain back off `/v1/approvals`.

## Budget movements are enqueued, never inline

An approved purchase order commits; a cancelled one releases; a paid bill
actualises and releases what approval reserved. All of it goes through
`budget.apply`, after the transaction commits — a commitment written inside a
transaction that then rolls back reserves money against a decision nobody made,
and nothing would ever notice.

## What is not here

An FX provider. A bill in a currency the budget is not in matches no budget, by
design: converting inside a control would put a rate nobody can reproduce
between the invoice and the limit it is checked against.

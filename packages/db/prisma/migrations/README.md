# Migrations

Ordered, checked-in SQL. `prisma db push` is forbidden outside a throwaway database
(`docs/09-DATABASE-DESIGN.md §10`) — a schema change that was never a reviewed file is a schema
change nobody can reproduce.

## Hand-written SQL in a generated file

Every migration here starts as `prisma migrate diff` output and may then be **appended to by
hand**. Prisma's schema language cannot express:

- `CHECK` constraints
- partial and expression indexes
- `REVOKE` / `GRANT`
- triggers

All four are load-bearing in this schema. The audit actor rule, the immutability of
`audit_events`, and the uniqueness of a system role's key exist only in the hand-written section
of `20260901000000_phase1_identity_tenancy_audit/migration.sql`. Deleting that section does not
break the build — it silently removes the guarantee, which is why it is fenced off with a comment
banner rather than merged into the generated statements.

## The drift warning

Because those objects are invisible to Prisma, `prisma migrate dev` will not see them when it
compares the schema to the database. It does not try to drop `CHECK` constraints or grants, but it
**does** notice the partial unique index `uq_roles_system_key` and will offer to remove it.

Never accept that. If `migrate dev` proposes dropping anything from the hand-written section:

1. Cancel.
2. Make the schema change you intended.
3. Generate the new migration with `--create-only`.
4. Re-add anything the diff removed, and commit both halves together.

## Generating a migration without a database

The reference development host has no reachable database of its own
(`docs/REPOSITORY_AUDIT.md` P1), so migrations can be produced offline:

```bash
pnpm --filter @financy/db exec prisma migrate diff \
  --from-migrations ./prisma/migrations \
  --to-schema-datamodel ./prisma/schema.prisma \
  --shadow-database-url "$SHADOW_DATABASE_URL" \
  --script > prisma/migrations/<timestamp>_<name>/migration.sql
```

`--from-empty` replaces `--from-migrations` for the very first one. The result is real SQL, but it
is **not verified** until it has been applied — see below.

## Applying and verifying

```bash
pnpm db:migrate          # development: applies and records
pnpm db:migrate:deploy   # CI and production: applies only, never generates
pnpm db:seed             # system catalogue, plus demo data outside production
```

A migration is not done until it has been applied to an empty database *and* to a seeded copy
(`docs/19-DEFINITION-OF-DONE.md`). CI does the first on every pull request. Generating SQL and
reading it is not the same as running it, and the difference is usually a constraint that turns
out to reference a column that does not exist yet.

## Expand / contract

Deploys are zero-downtime, so a breaking change is always three of them: expand, backfill,
contract. Never rename a column in one step; never add a `NOT NULL` column without a default to a
populated table; always build indexes `CONCURRENTLY` above 100,000 rows. `docs/09 §10` is the full
rule set.

Rollback is forward-only in production. A bad migration is corrected by a new migration, which is
why every migration must remain compatible with the previous release's code.

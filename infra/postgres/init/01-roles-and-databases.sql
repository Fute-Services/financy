-- ═══════════════════════════════════════════════════════════════════════════
--  Provision the roles, databases, and extensions the application expects.
--
--  Runs once, on first container start, before anything connects.
--
--  The application must NEVER connect as the postgres superuser, in any
--  environment (audit finding P1). Making the container match that rule means
--  a developer cannot accidentally get used to superuser access locally and
--  then discover in staging that half the code assumed it.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE ROLE financy_app WITH LOGIN PASSWORD 'financy_app';

CREATE DATABASE financy_dev  OWNER financy_app;
CREATE DATABASE financy_test OWNER financy_app;

-- Extensions are per-database and must be installed by a superuser, which is
-- why they are here rather than in a migration. docs/09 §11 is the list.
\connect financy_dev
CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- digests, gen_random_uuid() fallback
CREATE EXTENSION IF NOT EXISTS citext;     -- case-insensitive email and slug
CREATE EXTENSION IF NOT EXISTS pg_trgm;    -- fuzzy merchant and vendor search
CREATE EXTENSION IF NOT EXISTS btree_gin;  -- composite GIN over scalar + JSONB

\connect financy_test
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS btree_gin;

# PostgreSQL Database — Setup Guide

Enterprise schema for the Cassian Audit, Tax & Accounting Management System.
PostgreSQL **14+** (uses `pgcrypto` for `gen_random_uuid()` / bcrypt `crypt()`, and `citext` for case-insensitive emails).

## Contents

```
database/postgres/
├─ schema.sql                 # aggregator (applies all migrations via psql \ir)
├─ migrations/
│  ├─ 0001_extensions_auth.sql        roles, permissions, users, sessions, login history, resets
│  ├─ 0002_clients.sql                clients (+ contacts/addresses/services/drive_links), access
│  ├─ 0003_audit_workflow.sql         audit_engagements, audit_stages + history/tasks/reviews/comments/findings/signoffs
│  ├─ 0004_documents_tasks.sql        documents (+versions/categories/access_logs), tasks, calendar, notifications
│  ├─ 0005_accounting_tax.sql         accounting suite + statutory_deadlines + VAT/PAYE/WCF/NSSF/PDPC + reminders
│  ├─ 0006_ai_reporting_system.sql    AI tables, reports, activity_log, app_settings
│  └─ 0007_views_security.sql         API views, append-only audit trail, row-level security
├─ seed.sql                   # sample Tanzanian data (passwords hashed via pgcrypto)
├─ ERD.mermaid                # full entity-relationship diagram
└─ ERD.svg                    # schema module map
```

## 1. Install PostgreSQL

- Windows/macOS: install from https://www.postgresql.org/download (this also installs **pgAdmin**, a GUI).
- Verify: `psql --version`.

## 2. Create the database

```bash
# using the default superuser 'postgres'
createdb -U postgres cassian_pms
# (or in psql:  CREATE DATABASE cassian_pms;)
```

## 3. Apply the schema

**Option A — one command with psql (recommended):**
```bash
cd database/postgres
psql -U postgres -d cassian_pms -f schema.sql     # runs all migrations in order
psql -U postgres -d cassian_pms -f seed.sql       # loads sample data
```

**Option B — from the Node app (sequential migration runner):**
```bash
# from the project root, with .env configured (see below)
npm run migrate     # applies any unapplied migrations, tracked in schema_migrations
npm run seed        # runs database/postgres/seed.sql
```

**Option C — pgAdmin:** open the Query Tool on `cassian_pms`, then run each file in
`migrations/` in numeric order, then `seed.sql`.

## 4. Connect the application

The app reads either a single `DATABASE_URL` or discrete `PG*` variables (see `.env.example`):

```
DATABASE_URL=postgres://postgres:yourpassword@localhost:5432/cassian_pms
# or
PGHOST=localhost
PGPORT=5432
PGUSER=postgres
PGPASSWORD=yourpassword
PGDATABASE=cassian_pms
```

Default sample login: **info@cassian.co.tz / Password123!** (Admin). All seeded users share that password.

## 5. Design highlights

- **Keys & integrity:** every table has a UUID primary key (`gen_random_uuid()`), foreign keys with explicit `ON DELETE` rules (CASCADE for owned rows, SET NULL for optional references), and `CHECK` constraints on enumerated columns (status, category, type, priority, etc.).
- **Indexes:** all foreign keys plus targeted composite indexes (`clients(firm_id, category)`, `tasks(assignee_id, status)`, `statutory_deadlines(due_date, status)`, `documents(client_id, year, doc_type)`) and a **GIN full-text index** on `documents(name, ocr_text)` for smart search.
- **Soft deletes & timestamps:** `deleted_at` on clients/users/documents; `created_at`/`updated_at` on all mutable tables, with `updated_at` maintained by triggers.
- **Audit trail:** `activity_log` is append-only (a trigger blocks UPDATE/DELETE).
- **Multi-tenant:** every business table carries `firm_id`. Row-level security policies (in 0007) enforce firm isolation for non-owner database roles; the app role owns the tables and scopes access in queries + RBAC.
- **Money & currency:** `NUMERIC(18,2)` amounts with explicit `currency` columns (TZS/USD) and `fx_rate` on journal lines — never floating point.
- **API-ready views:** `v_client_overview`, `v_engagement_progress`, `v_upcoming_deadlines`.

## 6. Performance & scale

Indexing and pagination-friendly ordering support large datasets; heavy reporting can run against a read replica. For very large audit files, store binaries in Google Drive (the `documents` table holds metadata + `drive_file_id`) rather than in the database. Connection pooling is handled by the app (`pg.Pool`); add PgBouncer in front for many concurrent instances.

## 7. Backup & restore

```bash
pg_dump -U postgres -Fc cassian_pms > cassian_pms_$(date +%F).dump   # backup
pg_restore -U postgres -d cassian_pms --clean cassian_pms_2026-05-23.dump   # restore
```
Schedule daily dumps and test restores. With the PDPC in mind, define retention per data type and purge expired personal data on schedule.

## 8. Row-level security (optional, for BI/read-only roles)

```sql
CREATE ROLE reporting LOGIN PASSWORD '...';
GRANT SELECT ON ALL TABLES IN SCHEMA public TO reporting;
-- the reporting role then runs, per session:
SET app.current_firm = '<firm-uuid>';   -- RLS limits rows to that firm
```
The application's own role owns the tables and bypasses RLS, scoping access through RBAC and per-client checks in the API layer.

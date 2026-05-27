-- ============================================================
--  Cassian PMS — full PostgreSQL schema (aggregator)
--  Applies every migration in order. Run with psql:
--      psql -U postgres -d cassian_pms -f schema.sql
--  (\ir is a psql meta-command that includes files relative
--   to this script. For non-psql tools, run the files in
--   ./migrations/ in numeric order, then seed.sql.)
-- ============================================================
\echo 'Applying Cassian PMS schema...'
\ir migrations/0001_extensions_auth.sql
\ir migrations/0002_clients.sql
\ir migrations/0003_audit_workflow.sql
\ir migrations/0004_documents_tasks.sql
\ir migrations/0005_accounting_tax.sql
\ir migrations/0006_ai_reporting_system.sql
\ir migrations/0007_views_security.sql
\echo 'Schema applied. Load sample data with:  psql -d cassian_pms -f seed.sql'

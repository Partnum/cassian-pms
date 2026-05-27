-- ============================================================
--  0007 — API-ready views, audit-trail immutability, row-level security
-- ============================================================

-- ---------- Reporting / API views ----------
CREATE OR REPLACE VIEW v_client_overview AS
SELECT c.id, c.firm_id, c.name AS company_name, c.category, c.tin, c.vrn,
       c.sector AS industry, c.status AS engagement_status, c.financial_year_end,
       c.drive_folder_id AS google_drive_folder_id,
       mu.full_name AS assigned_manager, pu.full_name AS assigned_partner,
       (SELECT count(*) FROM audit_engagements e WHERE e.client_id=c.id) AS engagement_count,
       (SELECT count(*) FROM documents d WHERE d.client_id=c.id AND d.deleted_at IS NULL) AS document_count
FROM clients c
LEFT JOIN users mu ON mu.id=c.manager_id
LEFT JOIN users pu ON pu.id=c.engagement_partner_id
WHERE c.deleted_at IS NULL;

CREATE OR REPLACE VIEW v_engagement_progress AS
SELECT e.id, e.firm_id, e.client_id, c.name AS client_name, e.type,
       e.current_stage, e.progress_pct, e.status,
       mu.full_name AS manager_name, pu.full_name AS partner_name,
       e.target_completion
FROM audit_engagements e
JOIN clients c ON c.id=e.client_id
LEFT JOIN users mu ON mu.id=e.manager_id
LEFT JOIN users pu ON pu.id=e.partner_id;

CREATE OR REPLACE VIEW v_upcoming_deadlines AS
SELECT o.id, o.firm_id, o.client_id, c.name AS client_name, o.type, o.authority,
       o.period, o.due_date, o.status,
       (o.due_date - CURRENT_DATE) AS days_remaining
FROM statutory_deadlines o
JOIN clients c ON c.id=o.client_id
WHERE o.status NOT IN ('filed','exempt')
ORDER BY o.due_date;

-- ---------- Append-only audit trail ----------
CREATE OR REPLACE FUNCTION prevent_change() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'activity_log is append-only'; END; $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_activity_immutable
  BEFORE UPDATE OR DELETE ON activity_log
  FOR EACH ROW EXECUTE FUNCTION prevent_change();

-- ---------- Row-level security (firm isolation) ----------
-- The application connects as the table owner, which BYPASSES RLS, so these
-- policies do not affect the current app. They provide tenant isolation for
-- non-owner roles (e.g. a read-only reporting/BI role). Such a role would run:
--     SET app.current_firm = '<firm uuid>';
-- before querying. Add new tables here as needed.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['clients','audit_engagements','documents','tasks',
                           'statutory_deadlines','notifications','ai_logs'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format($p$CREATE POLICY firm_isolation ON %I
       USING (firm_id::text = current_setting('app.current_firm', true));$p$, t);
  END LOOP;
END $$;

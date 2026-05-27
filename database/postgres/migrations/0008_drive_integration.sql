-- ============================================================
--  0008 — Google Drive integration
--  Per-user OAuth, incremental sync state, document intelligence
--  columns, and the missing-document requirements checklist.
-- ============================================================

-- ---- Per-user Google Drive connections (multi-account) ----
CREATE TABLE drive_connections (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id      UUID NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  google_email VARCHAR(180),
  token        JSONB NOT NULL,                 -- access/refresh tokens (encrypt at rest in prod)
  scopes       VARCHAR(400),
  status       VARCHAR(15) NOT NULL DEFAULT 'connected'
                 CHECK (status IN ('connected','revoked','error')),
  connected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id)
);
CREATE INDEX idx_driveconn_firm ON drive_connections(firm_id);
CREATE TRIGGER trg_driveconn_upd BEFORE UPDATE ON drive_connections FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---- Incremental sync state (Drive Changes API) ----
CREATE TABLE drive_sync_state (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id          UUID NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  connection_id    UUID REFERENCES drive_connections(id) ON DELETE CASCADE,
  start_page_token VARCHAR(120),
  last_synced_at   TIMESTAMPTZ,
  status           VARCHAR(15) NOT NULL DEFAULT 'idle'
                     CHECK (status IN ('idle','running','error')),
  last_error       TEXT,
  stats            JSONB DEFAULT '{}'::jsonb,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_syncstate_conn ON drive_sync_state(connection_id);
CREATE TRIGGER trg_syncstate_upd BEFORE UPDATE ON drive_sync_state FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---- Document intelligence columns ----
ALTER TABLE documents ADD COLUMN IF NOT EXISTS detected_type   VARCHAR(40);
ALTER TABLE documents ADD COLUMN IF NOT EXISTS classified_conf NUMERIC(4,3);
ALTER TABLE documents ADD COLUMN IF NOT EXISTS auto_tagged     SMALLINT NOT NULL DEFAULT 0;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS modified_time   TIMESTAMPTZ;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS md5_checksum    VARCHAR(64);
ALTER TABLE documents ADD COLUMN IF NOT EXISTS drive_parent_id VARCHAR(120);
ALTER TABLE documents ADD COLUMN IF NOT EXISTS subfolder       VARCHAR(60);
ALTER TABLE documents ADD COLUMN IF NOT EXISTS extracted       JSONB;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS tags            TEXT[];
CREATE INDEX IF NOT EXISTS idx_documents_detected ON documents(detected_type);

-- ---- Missing-document requirements checklist ----
CREATE TABLE document_requirements (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id   UUID REFERENCES firms(id) ON DELETE CASCADE,
  category  VARCHAR(20) NOT NULL,              -- Audit/Tax/Accounting/Consultancy
  doc_type  VARCHAR(40) NOT NULL,              -- maps to documents.doc_type / detected_type
  label     VARCHAR(120) NOT NULL,
  required  SMALLINT NOT NULL DEFAULT 1,
  sort      INT NOT NULL DEFAULT 0
);
CREATE INDEX idx_docreq_cat ON document_requirements(category);

-- Default requirement sets (firm_id NULL = global defaults)
INSERT INTO document_requirements (category, doc_type, label, sort) VALUES
  ('Audit','engagement_letter','Engagement Letter (EL)',1),
  ('Audit','bank_statement','Bank Statements',2),
  ('Audit','trial_balance','Trial Balance',3),
  ('Audit','working_paper','Working Papers',4),
  ('Audit','financial_statements','Draft Financial Statements',5),
  ('Audit','financial_statements','Final Financial Statements',6),
  ('Audit','tax_return','Return of Income (ROI)',7),
  ('Audit','tra_document','TRA Documents',8),
  ('Audit','wcf_nssf_pdpc','WCF / NSSF / PDPC',9),
  ('Tax','tax_return','Tax Return',1),
  ('Tax','vat_schedule','VAT Schedule',2),
  ('Tax','bank_statement','Bank Statements',3),
  ('Tax','proof_of_payment','Proof of Payment (POP)',4),
  ('Accounting','bank_statement','Bank Statements',1),
  ('Accounting','invoice','Invoices',2),
  ('Accounting','payroll','Payroll',3),
  ('Accounting','trial_balance','Trial Balance',4);

-- ============================================================
--  0004 — Documents, tasks, calendar, reminders, notifications
-- ============================================================

CREATE TABLE document_categories (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id   UUID REFERENCES firms(id) ON DELETE CASCADE,
  code      VARCHAR(40) NOT NULL,
  name      VARCHAR(120) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE documents (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id         UUID NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  client_id       UUID REFERENCES clients(id) ON DELETE SET NULL,
  engagement_id   UUID REFERENCES audit_engagements(id) ON DELETE SET NULL,
  category_id     UUID REFERENCES document_categories(id) ON DELETE SET NULL,
  drive_file_id   VARCHAR(120),
  storage         VARCHAR(20) NOT NULL DEFAULT 'local',   -- 'google' | 'local'
  local_path      VARCHAR(255),
  name            VARCHAR(255) NOT NULL,
  doc_type        VARCHAR(40) NOT NULL DEFAULT 'other'
                    CHECK (doc_type IN ('financial_statements','bank_statement','tra_document',
                      'tax_return','engagement_letter','proof_of_payment','invoice','payroll',
                      'wcf_nssf_pdpc','working_paper','other')),
  year            INT,
  mime_type       VARCHAR(120),
  size_bytes      BIGINT NOT NULL DEFAULT 0,
  web_link        VARCHAR(500),
  uploaded_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  current_version INT NOT NULL DEFAULT 1,
  ocr_text        TEXT,
  ocr_status      VARCHAR(20) DEFAULT 'none',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at      TIMESTAMPTZ
);
CREATE INDEX idx_doc_client_year ON documents(client_id, year, doc_type);
CREATE INDEX idx_doc_search ON documents USING gin (to_tsvector('simple', coalesce(name,'') || ' ' || coalesce(ocr_text,'')));
CREATE TRIGGER trg_doc_upd BEFORE UPDATE ON documents FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE document_versions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id       UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  version           INT NOT NULL,
  drive_revision_id VARCHAR(120),
  size_bytes        BIGINT DEFAULT 0,
  uploaded_by       UUID REFERENCES users(id) ON DELETE SET NULL,
  note              VARCHAR(255),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_docver_doc ON document_versions(document_id);

CREATE TABLE document_access_logs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  user_id     UUID REFERENCES users(id) ON DELETE SET NULL,
  action      VARCHAR(20) NOT NULL DEFAULT 'view',   -- view/download/upload/delete
  ip_address  VARCHAR(64),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_docaccess_doc ON document_access_logs(document_id);

CREATE TABLE tasks (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id       UUID NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  title         VARCHAR(220) NOT NULL,
  description   TEXT,
  client_id     UUID REFERENCES clients(id) ON DELETE SET NULL,
  engagement_id UUID REFERENCES audit_engagements(id) ON DELETE SET NULL,
  assignee_id   UUID REFERENCES users(id) ON DELETE SET NULL,
  created_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  priority      VARCHAR(10) NOT NULL DEFAULT 'normal'
                  CHECK (priority IN ('low','normal','high','urgent')),
  status        VARCHAR(15) NOT NULL DEFAULT 'open'
                  CHECK (status IN ('open','in_progress','done','cancelled')),
  is_recurring  SMALLINT NOT NULL DEFAULT 0,
  recurrence_rule VARCHAR(120),
  due_date      TIMESTAMPTZ,
  completed_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_tasks_assignee ON tasks(assignee_id, status);
CREATE INDEX idx_tasks_due ON tasks(due_date);
CREATE TRIGGER trg_tasks_upd BEFORE UPDATE ON tasks FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE task_comments (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id   UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id   UUID REFERENCES users(id) ON DELETE SET NULL,
  body      TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE task_attachments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id     UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  document_id UUID REFERENCES documents(id) ON DELETE SET NULL,
  file_name   VARCHAR(255),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE calendar_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id       UUID NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  title         VARCHAR(220) NOT NULL,
  type          VARCHAR(40) DEFAULT 'event',
  client_id     UUID REFERENCES clients(id) ON DELETE SET NULL,
  engagement_id UUID REFERENCES audit_engagements(id) ON DELETE SET NULL,
  start_at      TIMESTAMPTZ NOT NULL,
  end_at        TIMESTAMPTZ,
  all_day       SMALLINT NOT NULL DEFAULT 0,
  color         VARCHAR(20),
  created_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_cal_start ON calendar_events(start_at);

CREATE TABLE notifications (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id     UUID NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  user_id     UUID REFERENCES users(id) ON DELETE CASCADE,
  type        VARCHAR(40) NOT NULL DEFAULT 'info',
  title       VARCHAR(220) NOT NULL,
  body        TEXT,
  link        VARCHAR(255),
  is_read     SMALLINT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_notif_user ON notifications(user_id, is_read);

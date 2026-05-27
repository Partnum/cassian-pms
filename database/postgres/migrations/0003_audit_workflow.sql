-- ============================================================
--  0003 — Audit workflow
--  Flow: Planning -> Engagement Letter -> Fieldwork -> Manager Review
--   -> Partner Review -> Draft Financial Report -> Client Sign-off
--   -> ROI Submission -> Completed
-- ============================================================

CREATE TABLE audit_engagements (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id           UUID NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  client_id         UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  type              VARCHAR(20) NOT NULL DEFAULT 'Audit'
                      CHECK (type IN ('Audit','Tax','Accounting','Consultancy')),
  financial_year    INT,
  period_start      DATE,
  period_end        DATE,
  partner_id        UUID REFERENCES users(id) ON DELETE SET NULL,
  manager_id        UUID REFERENCES users(id) ON DELETE SET NULL,
  status            VARCHAR(60) DEFAULT 'In progress',
  current_stage     VARCHAR(60) NOT NULL DEFAULT 'Planning',
  progress_pct      INT NOT NULL DEFAULT 0 CHECK (progress_pct BETWEEN 0 AND 100),
  fee_amount        NUMERIC(18,2),
  fee_currency      VARCHAR(8) DEFAULT 'TZS',
  planned_start     DATE,
  target_completion DATE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_eng_client ON audit_engagements(client_id);
CREATE INDEX idx_eng_firm ON audit_engagements(firm_id);
CREATE TRIGGER trg_eng_upd BEFORE UPDATE ON audit_engagements FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE audit_stages (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  engagement_id       UUID NOT NULL REFERENCES audit_engagements(id) ON DELETE CASCADE,
  sequence            INT NOT NULL,
  name                VARCHAR(60) NOT NULL,
  status              VARCHAR(20) NOT NULL DEFAULT 'not_started'
                        CHECK (status IN ('not_started','in_progress','blocked','completed')),
  progress_pct        INT NOT NULL DEFAULT 0,
  responsible_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  started_at          TIMESTAMPTZ,
  completed_at        TIMESTAMPTZ,
  due_date            DATE,
  notes               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_stages_eng ON audit_stages(engagement_id);

CREATE TABLE audit_workflow_history (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  engagement_id UUID NOT NULL REFERENCES audit_engagements(id) ON DELETE CASCADE,
  from_stage    VARCHAR(60),
  to_stage      VARCHAR(60) NOT NULL,
  action        VARCHAR(40) NOT NULL DEFAULT 'advance',
  changed_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  note          TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_wfh_eng ON audit_workflow_history(engagement_id);

CREATE TABLE audit_tasks (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  engagement_id UUID NOT NULL REFERENCES audit_engagements(id) ON DELETE CASCADE,
  stage_id      UUID REFERENCES audit_stages(id) ON DELETE SET NULL,
  title         VARCHAR(220) NOT NULL,
  description   TEXT,
  assignee_id   UUID REFERENCES users(id) ON DELETE SET NULL,
  status        VARCHAR(20) NOT NULL DEFAULT 'open'
                  CHECK (status IN ('open','in_progress','done','cancelled')),
  due_date      DATE,
  completed_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_audittasks_eng ON audit_tasks(engagement_id);

CREATE TABLE audit_reviews (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  engagement_id UUID NOT NULL REFERENCES audit_engagements(id) ON DELETE CASCADE,
  stage_id      UUID REFERENCES audit_stages(id) ON DELETE SET NULL,
  level         VARCHAR(20) NOT NULL DEFAULT 'manager'
                  CHECK (level IN ('manager','partner','eqcr')),
  reviewer_id   UUID REFERENCES users(id) ON DELETE SET NULL,
  status        VARCHAR(20) NOT NULL DEFAULT 'open'
                  CHECK (status IN ('open','cleared')),
  note          TEXT,
  cleared_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE audit_comments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  engagement_id UUID NOT NULL REFERENCES audit_engagements(id) ON DELETE CASCADE,
  stage_id      UUID REFERENCES audit_stages(id) ON DELETE SET NULL,
  user_id       UUID REFERENCES users(id) ON DELETE SET NULL,
  body          TEXT NOT NULL,
  type          VARCHAR(20) NOT NULL DEFAULT 'comment'
                  CHECK (type IN ('comment','review_note','query')),
  parent_id     UUID REFERENCES audit_comments(id) ON DELETE CASCADE,
  resolved_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE audit_findings (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  engagement_id UUID NOT NULL REFERENCES audit_engagements(id) ON DELETE CASCADE,
  reference_no  VARCHAR(40),
  area          VARCHAR(80),
  title         VARCHAR(220) NOT NULL,
  description   TEXT,
  risk_rating   VARCHAR(20) DEFAULT 'medium'
                  CHECK (risk_rating IN ('low','medium','high','significant')),
  recommendation     TEXT,
  management_response TEXT,
  status        VARCHAR(20) NOT NULL DEFAULT 'open'
                  CHECK (status IN ('open','resolved','reported')),
  created_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE audit_signoffs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  engagement_id UUID NOT NULL REFERENCES audit_engagements(id) ON DELETE CASCADE,
  stage         VARCHAR(60) NOT NULL,
  sign_role     VARCHAR(20) NOT NULL CHECK (sign_role IN ('Manager','Partner','EQCR')),
  user_id       UUID REFERENCES users(id) ON DELETE SET NULL,
  signed_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  note          TEXT
);

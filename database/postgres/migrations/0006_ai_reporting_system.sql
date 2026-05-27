-- ============================================================
--  0006 — AI module, reporting, system (audit trail, settings)
-- ============================================================

-- ---------- AI ----------
CREATE TABLE ai_logs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id       UUID NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  user_id       UUID REFERENCES users(id) ON DELETE SET NULL,
  client_id     UUID REFERENCES clients(id) ON DELETE SET NULL,
  engagement_id UUID REFERENCES audit_engagements(id) ON DELETE SET NULL,
  feature       VARCHAR(40) NOT NULL DEFAULT 'chat',
  prompt        TEXT,
  response      TEXT,
  model         VARCHAR(60),
  tokens        INT DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_ai_user ON ai_logs(user_id);

CREATE TABLE ai_queries (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id    UUID NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  user_id    UUID REFERENCES users(id) ON DELETE SET NULL,
  client_id  UUID REFERENCES clients(id) ON DELETE SET NULL,
  query_text TEXT NOT NULL,
  context    VARCHAR(80),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE ai_recommendations (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id       UUID NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  engagement_id UUID REFERENCES audit_engagements(id) ON DELETE CASCADE,
  type          VARCHAR(30) NOT NULL DEFAULT 'finding'
                  CHECK (type IN ('finding','ml_point','tax_alert','ratio','risk')),
  title         VARCHAR(220) NOT NULL,
  detail        JSONB,
  status        VARCHAR(12) NOT NULL DEFAULT 'open' CHECK (status IN ('open','accepted','dismissed')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE ai_risk_analysis (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id       UUID NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  engagement_id UUID REFERENCES audit_engagements(id) ON DELETE CASCADE,
  risk_area     VARCHAR(120) NOT NULL,
  rating        VARCHAR(20) NOT NULL DEFAULT 'medium'
                  CHECK (rating IN ('low','medium','high','significant')),
  assertion     VARCHAR(80),
  rationale     TEXT,
  response      TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE anomaly_detection_results (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id       UUID NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  client_id     UUID REFERENCES clients(id) ON DELETE CASCADE,
  engagement_id UUID REFERENCES audit_engagements(id) ON DELETE SET NULL,
  source        VARCHAR(40),                -- journals/documents/revenue/...
  description   TEXT NOT NULL,
  severity      VARCHAR(12) NOT NULL DEFAULT 'medium'
                  CHECK (severity IN ('low','medium','high')),
  score         NUMERIC(6,3),
  status        VARCHAR(12) NOT NULL DEFAULT 'open' CHECK (status IN ('open','reviewed','dismissed')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- Reporting ----------
CREATE TABLE report_templates (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id    UUID NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  name       VARCHAR(160) NOT NULL,
  type       VARCHAR(40),
  definition JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE reports (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id     UUID NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  name        VARCHAR(160) NOT NULL,
  type        VARCHAR(40),
  params      JSONB,
  template_id UUID REFERENCES report_templates(id) ON DELETE SET NULL,
  created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE exported_reports (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id      UUID NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  report_id    UUID REFERENCES reports(id) ON DELETE SET NULL,
  format       VARCHAR(10) NOT NULL DEFAULT 'pdf' CHECK (format IN ('pdf','xlsx','csv')),
  file_path    VARCHAR(255),
  drive_file_id VARCHAR(120),
  generated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- System: audit trail + settings ----------
CREATE TABLE activity_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id     UUID REFERENCES firms(id) ON DELETE SET NULL,
  user_id     UUID REFERENCES users(id) ON DELETE SET NULL,
  action      VARCHAR(80) NOT NULL,
  entity_type VARCHAR(60),
  entity_id   UUID,
  detail      JSONB,
  ip_address  VARCHAR(64),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_act_entity ON activity_log(entity_type, entity_id);
CREATE INDEX idx_act_user ON activity_log(user_id);
CREATE INDEX idx_act_created ON activity_log(created_at);

CREATE TABLE app_settings (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id       UUID REFERENCES firms(id) ON DELETE CASCADE,
  setting_key   VARCHAR(80) NOT NULL UNIQUE,
  setting_value TEXT,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

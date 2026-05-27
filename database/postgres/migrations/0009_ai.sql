-- ============================================================
--  0009 — AI module: conversation memory, risk assessments,
--  recommendation enrichments.
-- ============================================================

-- ---- Conversation memory (chat with audit/accounting context) ----
CREATE TABLE ai_conversations (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id       UUID NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  user_id       UUID REFERENCES users(id) ON DELETE SET NULL,
  client_id     UUID REFERENCES clients(id) ON DELETE SET NULL,
  engagement_id UUID REFERENCES audit_engagements(id) ON DELETE SET NULL,
  title         VARCHAR(220) DEFAULT 'New conversation',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_ai_conv_user ON ai_conversations(user_id);
CREATE TRIGGER trg_ai_conv_upd BEFORE UPDATE ON ai_conversations FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE ai_messages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
  role            VARCHAR(12) NOT NULL CHECK (role IN ('user','assistant','system')),
  content         TEXT NOT NULL,
  citations       JSONB,
  tokens          INT DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_ai_msg_conv ON ai_messages(conversation_id, created_at);

-- ---- Risk assessments (Risk Center) ----
CREATE TABLE risk_assessments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id       UUID NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  client_id     UUID REFERENCES clients(id) ON DELETE CASCADE,
  engagement_id UUID REFERENCES audit_engagements(id) ON DELETE SET NULL,
  score         NUMERIC(5,2) NOT NULL DEFAULT 0,            -- 0..100
  level         VARCHAR(10) NOT NULL DEFAULT 'low' CHECK (level IN ('low','medium','high','critical')),
  factors       JSONB,                                       -- [{category,score,weight,detail}]
  model_version VARCHAR(20) DEFAULT 'rule-v1',
  computed_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_risk_client ON risk_assessments(client_id);
CREATE INDEX idx_risk_score ON risk_assessments(score DESC);

-- ---- Recommendation enrichments ----
ALTER TABLE ai_recommendations ADD COLUMN IF NOT EXISTS client_id UUID REFERENCES clients(id) ON DELETE CASCADE;
ALTER TABLE ai_recommendations ADD COLUMN IF NOT EXISTS severity VARCHAR(12) DEFAULT 'medium';
ALTER TABLE ai_recommendations ADD COLUMN IF NOT EXISTS source   VARCHAR(30) DEFAULT 'ai';
ALTER TABLE ai_recommendations DROP CONSTRAINT IF EXISTS ai_recommendations_type_check;
ALTER TABLE ai_recommendations ADD CONSTRAINT ai_recommendations_type_check
  CHECK (type IN ('finding','ml_point','tax_alert','ratio','risk','accounting','workflow','anomaly','control','compliance'));
CREATE INDEX IF NOT EXISTS idx_airec_client ON ai_recommendations(client_id);
CREATE INDEX IF NOT EXISTS idx_airec_status ON ai_recommendations(status);

-- ============================================================
--  0014 — Audit working papers / lead schedules
--  Indexed working papers per engagement (A1 Cash, B2 Revenue, …)
--  with prepared-by / reviewed-by sign-off and conclusions.
-- ============================================================
CREATE TABLE IF NOT EXISTS working_papers (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id       UUID NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  engagement_id UUID NOT NULL REFERENCES audit_engagements(id) ON DELETE CASCADE,
  reference     VARCHAR(20) NOT NULL,           -- index reference, e.g. A1, B2
  title         VARCHAR(200) NOT NULL,          -- e.g. Cash and bank
  section       VARCHAR(60),                    -- grouping (Planning, Balance sheet, P&L, Completion)
  status        VARCHAR(15) NOT NULL DEFAULT 'not_started'
                  CHECK (status IN ('not_started','in_progress','prepared','reviewed')),
  prepared_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  prepared_at   TIMESTAMPTZ,
  reviewed_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at   TIMESTAMPTZ,
  conclusion    TEXT,
  notes         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_wp_eng ON working_papers(engagement_id, reference);
CREATE TRIGGER trg_wp_upd BEFORE UPDATE ON working_papers FOR EACH ROW EXECUTE FUNCTION set_updated_at();

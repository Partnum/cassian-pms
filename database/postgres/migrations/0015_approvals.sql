-- ============================================================
--  0015 — Digital approvals & signatures
--  Generic approve/reject decisions with a typed digital signature
--  and timestamp, attachable to any entity (engagement, invoice,
--  report, working_paper, document).
-- ============================================================
CREATE TABLE IF NOT EXISTS approvals (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id     UUID NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  entity_type VARCHAR(30) NOT NULL,
  entity_id   UUID NOT NULL,
  decision    VARCHAR(10) NOT NULL CHECK (decision IN ('approved','rejected')),
  signature   VARCHAR(160),          -- typed name = digital signature
  comment     TEXT,
  user_id     UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_approvals_entity ON approvals(entity_type, entity_id, created_at);

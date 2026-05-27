-- ============================================================
--  0011 — Client collaboration: per-client comments / notes by area
-- ============================================================
CREATE TABLE IF NOT EXISTS client_comments (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id    UUID NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  client_id  UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  area       VARCHAR(20) NOT NULL DEFAULT 'general'
               CHECK (area IN ('general','audit','tax','accounting')),
  user_id    UUID REFERENCES users(id) ON DELETE SET NULL,
  body       TEXT NOT NULL,
  mentions   JSONB,                 -- array of mentioned user ids
  parent_id  UUID REFERENCES client_comments(id) ON DELETE CASCADE,
  edited_at  TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_client_comments_client ON client_comments(client_id, area, created_at);

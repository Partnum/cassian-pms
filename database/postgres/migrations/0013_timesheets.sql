-- ============================================================
--  0013 — Time tracking / timesheets
--  Hours logged per staff member, optionally against a client and task.
--  Feeds billing and client profitability analysis.
-- ============================================================
CREATE TABLE IF NOT EXISTS time_entries (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id     UUID NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id   UUID REFERENCES clients(id) ON DELETE SET NULL,
  task_id     UUID REFERENCES tasks(id) ON DELETE SET NULL,
  work_date   DATE NOT NULL,
  hours       NUMERIC(6,2) NOT NULL CHECK (hours > 0 AND hours <= 24),
  billable    SMALLINT NOT NULL DEFAULT 1,
  description VARCHAR(300),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_time_user ON time_entries(user_id, work_date);
CREATE INDEX IF NOT EXISTS idx_time_client ON time_entries(client_id, work_date);

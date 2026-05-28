-- ============================================================
--  0016 — Task ownership & accountability
--  Adds an optional reviewer (second pair of eyes) and a
--  department tag to tasks, so work can be routed and reviewed
--  by team / function rather than only by a single assignee.
-- ============================================================
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS reviewer_id UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS department VARCHAR(40);
CREATE INDEX IF NOT EXISTS idx_tasks_reviewer ON tasks(reviewer_id);

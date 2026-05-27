-- ============================================================
--  0012 — Client fee invoicing
--  Extends the invoices table so a firm can bill its OWN clients
--  (fee notes), in addition to the SaaS subscription invoices.
--  An invoice is a client fee invoice when client_id IS NOT NULL.
-- ============================================================
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS client_id UUID REFERENCES clients(id) ON DELETE SET NULL;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS notes VARCHAR(300);
CREATE INDEX IF NOT EXISTS idx_invoices_client ON invoices(client_id);

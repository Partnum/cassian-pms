-- ============================================================
--  0005 — Accounting & tax compliance
-- ============================================================

-- ---------- Accounting ----------
CREATE TABLE chart_of_accounts (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id    UUID NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  client_id  UUID REFERENCES clients(id) ON DELETE CASCADE,
  code       VARCHAR(20) NOT NULL,
  name       VARCHAR(160) NOT NULL,
  type       VARCHAR(12) NOT NULL CHECK (type IN ('asset','liability','equity','income','expense')),
  parent_id  UUID REFERENCES chart_of_accounts(id) ON DELETE SET NULL,
  is_active  SMALLINT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_coa_client ON chart_of_accounts(client_id);

CREATE TABLE journal_entries (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id    UUID NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  client_id  UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  ref_no     VARCHAR(40),
  entry_date DATE NOT NULL,
  narration  VARCHAR(255),
  currency   VARCHAR(8) NOT NULL DEFAULT 'TZS',
  status     VARCHAR(12) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','posted','reversed')),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  posted_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_journal_client ON journal_entries(client_id);

CREATE TABLE journal_lines (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  journal_id  UUID NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
  account_id  UUID NOT NULL REFERENCES chart_of_accounts(id) ON DELETE RESTRICT,
  description VARCHAR(255),
  debit       NUMERIC(18,2) NOT NULL DEFAULT 0,
  credit      NUMERIC(18,2) NOT NULL DEFAULT 0,
  currency    VARCHAR(8) NOT NULL DEFAULT 'TZS',
  fx_rate     NUMERIC(18,6) NOT NULL DEFAULT 1,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_jline_journal ON journal_lines(journal_id);
CREATE INDEX idx_jline_account ON journal_lines(account_id);

CREATE TABLE ledgers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id         UUID NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  client_id       UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  account_id      UUID NOT NULL REFERENCES chart_of_accounts(id) ON DELETE CASCADE,
  period          VARCHAR(20) NOT NULL,
  opening_balance NUMERIC(18,2) NOT NULL DEFAULT 0,
  debit_total     NUMERIC(18,2) NOT NULL DEFAULT 0,
  credit_total    NUMERIC(18,2) NOT NULL DEFAULT 0,
  closing_balance NUMERIC(18,2) NOT NULL DEFAULT 0,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE trial_balance (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id      UUID NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  client_id    UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  period       VARCHAR(20) NOT NULL,
  account_id   UUID NOT NULL REFERENCES chart_of_accounts(id) ON DELETE CASCADE,
  debit        NUMERIC(18,2) NOT NULL DEFAULT 0,
  credit       NUMERIC(18,2) NOT NULL DEFAULT 0,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE bank_accounts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id     UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  bank_name     VARCHAR(120) NOT NULL,
  account_no    VARCHAR(60),
  currency      VARCHAR(8) NOT NULL DEFAULT 'TZS',
  gl_account_id UUID REFERENCES chart_of_accounts(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE bank_transactions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_account_id UUID NOT NULL REFERENCES bank_accounts(id) ON DELETE CASCADE,
  txn_date        DATE NOT NULL,
  description     VARCHAR(255),
  amount          NUMERIC(18,2) NOT NULL,
  direction       VARCHAR(6) NOT NULL CHECK (direction IN ('debit','credit')),
  matched_line_id UUID REFERENCES journal_lines(id) ON DELETE SET NULL,
  is_reconciled   SMALLINT NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_banktxn_acct ON bank_transactions(bank_account_id);

CREATE TABLE bank_reconciliations (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_account_id    UUID NOT NULL REFERENCES bank_accounts(id) ON DELETE CASCADE,
  period             VARCHAR(20) NOT NULL,
  statement_balance  NUMERIC(18,2) NOT NULL DEFAULT 0,
  book_balance       NUMERIC(18,2) NOT NULL DEFAULT 0,
  reconciled_balance NUMERIC(18,2) NOT NULL DEFAULT 0,
  status             VARCHAR(15) NOT NULL DEFAULT 'open' CHECK (status IN ('open','reconciled')),
  prepared_by        UUID REFERENCES users(id) ON DELETE SET NULL,
  reviewed_by        UUID REFERENCES users(id) ON DELETE SET NULL,
  reconciled_at      TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- Tax compliance ----------
CREATE TABLE statutory_deadlines (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id      UUID NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  client_id    UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  type         VARCHAR(20) NOT NULL CHECK (type IN
                 ('VAT','PAYE','SDL','NSSF','WCF','PDPC','PROVISIONAL_TAX','ROI','OTHER')),
  authority    VARCHAR(10) NOT NULL DEFAULT 'TRA' CHECK (authority IN ('TRA','NSSF','WCF','PDPC','OTHER')),
  period       VARCHAR(40),
  due_date     DATE NOT NULL,
  status       VARCHAR(12) NOT NULL DEFAULT 'upcoming'
                 CHECK (status IN ('upcoming','due','filed','overdue','exempt')),
  filed_at     TIMESTAMPTZ,
  reference_no VARCHAR(80),
  amount       NUMERIC(18,2),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_deadline_due ON statutory_deadlines(due_date, status);
CREATE INDEX idx_deadline_client ON statutory_deadlines(client_id);
CREATE TRIGGER trg_deadline_upd BEFORE UPDATE ON statutory_deadlines FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE tax_returns (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id     UUID NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  client_id   UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  return_type VARCHAR(20) NOT NULL,            -- VAT/PAYE/WCF/NSSF/ROI/PROVISIONAL
  period      VARCHAR(40),
  due_date    DATE,
  filed_date  DATE,
  status      VARCHAR(12) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','filed','paid','overdue')),
  amount      NUMERIC(18,2),
  reference_no VARCHAR(80),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_taxret_client ON tax_returns(client_id);

CREATE TABLE tra_submissions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id       UUID NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  client_id     UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  return_id     UUID REFERENCES tax_returns(id) ON DELETE SET NULL,
  submission_ref VARCHAR(80),
  submitted_at  TIMESTAMPTZ,
  status        VARCHAR(15) NOT NULL DEFAULT 'submitted',
  payload       JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE vat_returns (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id     UUID NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  client_id   UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  period      VARCHAR(40) NOT NULL,
  output_vat  NUMERIC(18,2) NOT NULL DEFAULT 0,
  input_vat   NUMERIC(18,2) NOT NULL DEFAULT 0,
  net_payable NUMERIC(18,2) NOT NULL DEFAULT 0,
  due_date    DATE,
  filed_date  DATE,
  status      VARCHAR(12) NOT NULL DEFAULT 'upcoming',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE paye_returns (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id    UUID NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  client_id  UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  period     VARCHAR(40) NOT NULL,
  gross_pay  NUMERIC(18,2) NOT NULL DEFAULT 0,
  paye_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
  sdl_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
  due_date   DATE,
  filed_date DATE,
  status     VARCHAR(12) NOT NULL DEFAULT 'upcoming',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE wcf_returns (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id    UUID NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  client_id  UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  period     VARCHAR(40) NOT NULL,
  gross_pay  NUMERIC(18,2) NOT NULL DEFAULT 0,
  wcf_amount NUMERIC(18,2) NOT NULL DEFAULT 0,   -- 0.5% of gross
  due_date   DATE,
  filed_date DATE,
  status     VARCHAR(12) NOT NULL DEFAULT 'upcoming',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE nssf_returns (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id           UUID NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  client_id         UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  period            VARCHAR(40) NOT NULL,
  employee_contrib  NUMERIC(18,2) NOT NULL DEFAULT 0,
  employer_contrib  NUMERIC(18,2) NOT NULL DEFAULT 0,
  total_contrib     NUMERIC(18,2) NOT NULL DEFAULT 0,
  due_date          DATE,
  filed_date        DATE,
  status            VARCHAR(12) NOT NULL DEFAULT 'upcoming',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE pdpc_compliance (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id         UUID NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  client_id       UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  registration_no VARCHAR(80),
  registered_at   DATE,
  expires_at      DATE,
  status          VARCHAR(15) NOT NULL DEFAULT 'active',
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- Reminders (deadlines + tasks) ----------
CREATE TABLE reminders (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id     UUID NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  deadline_id UUID REFERENCES statutory_deadlines(id) ON DELETE CASCADE,
  task_id     UUID REFERENCES tasks(id) ON DELETE CASCADE,
  channel     VARCHAR(10) NOT NULL DEFAULT 'in_app' CHECK (channel IN ('email','in_app','sms')),
  fire_at     TIMESTAMPTZ NOT NULL,
  sent_at     TIMESTAMPTZ,
  status      VARCHAR(12) NOT NULL DEFAULT 'pending',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_reminders_fire ON reminders(fire_at, status);

-- ============================================================
--  0002 — Client management
--  NOTE: core column names are kept app-aligned; SQL COMMENTs map
--  them to the requested enterprise labels (company_name, etc.).
-- ============================================================

CREATE TABLE clients (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id               UUID NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  name                  VARCHAR(200) NOT NULL,             -- company_name
  category              VARCHAR(20) NOT NULL
                          CHECK (category IN ('Audit','Tax','Accounting','Consultancy')),
  tin                   VARCHAR(40),
  vrn                   VARCHAR(40),
  sector                VARCHAR(120),                      -- industry
  contact_name          VARCHAR(160),
  contact_email         VARCHAR(180),
  contact_phone         VARCHAR(40),
  physical_address      VARCHAR(255),
  financial_year_end    VARCHAR(40),                       -- financial_year
  base_currency         VARCHAR(8) NOT NULL DEFAULT 'TZS',
  engagement_partner_id UUID REFERENCES users(id) ON DELETE SET NULL,  -- assigned_partner
  manager_id            UUID REFERENCES users(id) ON DELETE SET NULL,  -- assigned_manager
  status                VARCHAR(60) DEFAULT 'Active',      -- engagement_status
  drive_folder_id       VARCHAR(120),                      -- google_drive_folder_id
  is_active             SMALLINT NOT NULL DEFAULT 1,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at            TIMESTAMPTZ
);
CREATE INDEX idx_clients_firm_cat ON clients(firm_id, category);
CREATE INDEX idx_clients_status ON clients(status);
COMMENT ON COLUMN clients.name IS 'company_name';
COMMENT ON COLUMN clients.sector IS 'industry';
COMMENT ON COLUMN clients.financial_year_end IS 'financial_year';
COMMENT ON COLUMN clients.status IS 'engagement_status';
COMMENT ON COLUMN clients.manager_id IS 'assigned_manager';
COMMENT ON COLUMN clients.engagement_partner_id IS 'assigned_partner';
COMMENT ON COLUMN clients.drive_folder_id IS 'google_drive_folder_id';

CREATE TRIGGER trg_clients_upd BEFORE UPDATE ON clients FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Per-client access scoping (row-level access support)
CREATE TABLE user_client_access (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id    UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  access_level VARCHAR(10) NOT NULL DEFAULT 'editor'
                 CHECK (access_level IN ('owner','editor','viewer')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, client_id)
);

CREATE TABLE client_contacts (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id  UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  name       VARCHAR(160) NOT NULL,
  title      VARCHAR(120),
  email      VARCHAR(180),
  phone      VARCHAR(40),
  is_primary SMALLINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_contacts_client ON client_contacts(client_id);

CREATE TABLE client_addresses (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id    UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  address_type VARCHAR(30) DEFAULT 'physical',   -- physical/postal/billing
  line1        VARCHAR(200),
  line2        VARCHAR(200),
  city         VARCHAR(80),
  region       VARCHAR(80),
  country      VARCHAR(60) DEFAULT 'Tanzania',
  postal_code  VARCHAR(30),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE client_services (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id   UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  service     VARCHAR(40) NOT NULL,             -- Audit/Tax/Accounting/Consultancy/Payroll
  fee_amount  NUMERIC(18,2),
  fee_currency VARCHAR(8) DEFAULT 'TZS',
  is_active   SMALLINT NOT NULL DEFAULT 1,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE client_drive_links (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id       UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  label           VARCHAR(120),                 -- e.g. '2025', 'Permanent File'
  drive_folder_id VARCHAR(120) NOT NULL,
  web_link        VARCHAR(500),
  year            INT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_drive_links_client ON client_drive_links(client_id);

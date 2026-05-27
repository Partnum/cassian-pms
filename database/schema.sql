-- ============================================================
--  Cassian PMS — MySQL / MariaDB schema
--  Compatible with the MySQL that ships with XAMPP.
--  Run via:  npm run migrate   (or import this file in phpMyAdmin)
-- ============================================================

CREATE DATABASE IF NOT EXISTS `cassian_pms`
  CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
USE `cassian_pms`;

SET FOREIGN_KEY_CHECKS = 0;

-- ---- Firm ----
CREATE TABLE IF NOT EXISTS firms (
  id            CHAR(36) PRIMARY KEY,
  name          VARCHAR(180) NOT NULL,
  tin           VARCHAR(40),
  vrn           VARCHAR(40),
  address       VARCHAR(255),
  country       VARCHAR(60) DEFAULT 'Tanzania',
  logo_url      VARCHAR(255),
  settings      JSON,
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- ---- Users / staff ----
CREATE TABLE IF NOT EXISTS users (
  id            CHAR(36) PRIMARY KEY,
  firm_id       CHAR(36) NOT NULL,
  full_name     VARCHAR(160) NOT NULL,
  email         VARCHAR(180) NOT NULL UNIQUE,
  phone         VARCHAR(40),
  password_hash VARCHAR(255) NOT NULL,
  role          VARCHAR(40) NOT NULL DEFAULT 'Staff',
  status        ENUM('active','invited','suspended','on_leave') DEFAULT 'active',
  avatar_url    VARCHAR(255),
  last_login_at DATETIME NULL,
  two_factor_enabled TINYINT(1) DEFAULT 0,
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at    DATETIME NULL,
  CONSTRAINT fk_users_firm FOREIGN KEY (firm_id) REFERENCES firms(id) ON DELETE CASCADE,
  INDEX idx_users_role (role),
  INDEX idx_users_firm (firm_id)
) ENGINE=InnoDB;

-- ---- Clients ----
CREATE TABLE IF NOT EXISTS clients (
  id                    CHAR(36) PRIMARY KEY,
  firm_id               CHAR(36) NOT NULL,
  name                  VARCHAR(200) NOT NULL,
  category              ENUM('Audit','Tax','Accounting','Consultancy') NOT NULL,
  tin                   VARCHAR(40),
  vrn                   VARCHAR(40),
  sector                VARCHAR(120),
  contact_name          VARCHAR(160),
  contact_email         VARCHAR(180),
  contact_phone         VARCHAR(40),
  physical_address      VARCHAR(255),
  financial_year_end    VARCHAR(20),
  base_currency         VARCHAR(8) DEFAULT 'TZS',
  engagement_partner_id CHAR(36) NULL,
  manager_id            CHAR(36) NULL,
  status                VARCHAR(60) DEFAULT 'Active',
  drive_folder_id       VARCHAR(120) NULL,
  is_active             TINYINT(1) DEFAULT 1,
  created_at            TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at            TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at            DATETIME NULL,
  CONSTRAINT fk_clients_firm FOREIGN KEY (firm_id) REFERENCES firms(id) ON DELETE CASCADE,
  CONSTRAINT fk_clients_partner FOREIGN KEY (engagement_partner_id) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_clients_manager FOREIGN KEY (manager_id) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_clients_firm_cat (firm_id, category),
  INDEX idx_clients_status (status)
) ENGINE=InnoDB;

-- ---- Client contacts ----
CREATE TABLE IF NOT EXISTS client_contacts (
  id          CHAR(36) PRIMARY KEY,
  client_id   CHAR(36) NOT NULL,
  name        VARCHAR(160) NOT NULL,
  title       VARCHAR(120),
  email       VARCHAR(180),
  phone       VARCHAR(40),
  is_primary  TINYINT(1) DEFAULT 0,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_contacts_client FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ---- Per-client access scoping ----
CREATE TABLE IF NOT EXISTS user_client_access (
  id            CHAR(36) PRIMARY KEY,
  user_id       CHAR(36) NOT NULL,
  client_id     CHAR(36) NOT NULL,
  access_level  ENUM('owner','editor','viewer') DEFAULT 'editor',
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_user_client (user_id, client_id),
  CONSTRAINT fk_uca_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_uca_client FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ---- Refresh tokens ----
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id          CHAR(36) PRIMARY KEY,
  user_id     CHAR(36) NOT NULL,
  token_hash  VARCHAR(255) NOT NULL,
  expires_at  DATETIME NOT NULL,
  revoked_at  DATETIME NULL,
  user_agent  VARCHAR(255),
  ip_address  VARCHAR(64),
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_rt_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_rt_user (user_id)
) ENGINE=InnoDB;

-- ---- Engagements (audit workflow header) ----
CREATE TABLE IF NOT EXISTS engagements (
  id                CHAR(36) PRIMARY KEY,
  firm_id           CHAR(36) NOT NULL,
  client_id         CHAR(36) NOT NULL,
  type              ENUM('Audit','Tax','Accounting','Consultancy') NOT NULL,
  financial_year    INT,
  period_start      DATE NULL,
  period_end        DATE NULL,
  partner_id        CHAR(36) NULL,
  manager_id        CHAR(36) NULL,
  status            VARCHAR(60) DEFAULT 'Active',
  current_stage     VARCHAR(60) DEFAULT 'Planning',
  progress_pct      INT DEFAULT 0,
  fee_amount        DECIMAL(18,2) NULL,
  fee_currency      VARCHAR(8) DEFAULT 'TZS',
  planned_start     DATE NULL,
  target_completion DATE NULL,
  created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_eng_firm FOREIGN KEY (firm_id) REFERENCES firms(id) ON DELETE CASCADE,
  CONSTRAINT fk_eng_client FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
  INDEX idx_eng_client (client_id)
) ENGINE=InnoDB;

-- ---- Engagement stages (per-stage status/progress/owner) ----
CREATE TABLE IF NOT EXISTS engagement_stages (
  id                  CHAR(36) PRIMARY KEY,
  engagement_id       CHAR(36) NOT NULL,
  sequence            INT NOT NULL,
  name                VARCHAR(60) NOT NULL,
  status              ENUM('not_started','in_progress','blocked','completed') DEFAULT 'not_started',
  progress_pct        INT DEFAULT 0,
  responsible_user_id CHAR(36) NULL,
  started_at          DATETIME NULL,
  completed_at        DATETIME NULL,
  due_date            DATE NULL,
  notes               TEXT NULL,
  CONSTRAINT fk_es_eng FOREIGN KEY (engagement_id) REFERENCES engagements(id) ON DELETE CASCADE,
  INDEX idx_es_eng (engagement_id)
) ENGINE=InnoDB;

-- ---- Workflow transition history ----
CREATE TABLE IF NOT EXISTS workflow_history (
  id            CHAR(36) PRIMARY KEY,
  engagement_id CHAR(36) NOT NULL,
  from_stage    VARCHAR(60) NULL,
  to_stage      VARCHAR(60) NOT NULL,
  action        VARCHAR(40) DEFAULT 'advance',
  changed_by    CHAR(36) NULL,
  note          TEXT NULL,
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_wh_eng FOREIGN KEY (engagement_id) REFERENCES engagements(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ---- Tasks ----
CREATE TABLE IF NOT EXISTS tasks (
  id            CHAR(36) PRIMARY KEY,
  firm_id       CHAR(36) NOT NULL,
  title         VARCHAR(220) NOT NULL,
  description   TEXT,
  client_id     CHAR(36) NULL,
  engagement_id CHAR(36) NULL,
  assignee_id   CHAR(36) NULL,
  created_by    CHAR(36) NULL,
  priority      ENUM('low','normal','high','urgent') DEFAULT 'normal',
  status        ENUM('open','in_progress','done','cancelled') DEFAULT 'open',
  due_date      DATETIME NULL,
  completed_at  DATETIME NULL,
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_tasks_firm FOREIGN KEY (firm_id) REFERENCES firms(id) ON DELETE CASCADE,
  CONSTRAINT fk_tasks_client FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL,
  CONSTRAINT fk_tasks_eng FOREIGN KEY (engagement_id) REFERENCES engagements(id) ON DELETE SET NULL,
  CONSTRAINT fk_tasks_assignee FOREIGN KEY (assignee_id) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_tasks_assignee (assignee_id, status),
  INDEX idx_tasks_due (due_date)
) ENGINE=InnoDB;

-- ---- Statutory obligations (tax compliance) ----
CREATE TABLE IF NOT EXISTS statutory_obligations (
  id            CHAR(36) PRIMARY KEY,
  firm_id       CHAR(36) NOT NULL,
  client_id     CHAR(36) NOT NULL,
  type          ENUM('VAT','PAYE','SDL','NSSF','WCF','PDPC','PROVISIONAL_TAX','ROI','OTHER') NOT NULL,
  authority     ENUM('TRA','NSSF','WCF','PDPC','OTHER') DEFAULT 'TRA',
  period        VARCHAR(40),
  due_date      DATE NOT NULL,
  status        ENUM('upcoming','due','filed','overdue','exempt') DEFAULT 'upcoming',
  filed_at      DATETIME NULL,
  reference_no  VARCHAR(80) NULL,
  amount        DECIMAL(18,2) NULL,
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_obl_firm FOREIGN KEY (firm_id) REFERENCES firms(id) ON DELETE CASCADE,
  CONSTRAINT fk_obl_client FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
  INDEX idx_obl_due (due_date, status)
) ENGINE=InnoDB;

-- ---- Notifications ----
CREATE TABLE IF NOT EXISTS notifications (
  id          CHAR(36) PRIMARY KEY,
  firm_id     CHAR(36) NOT NULL,
  user_id     CHAR(36) NULL,
  type        VARCHAR(40) DEFAULT 'info',
  title       VARCHAR(220) NOT NULL,
  body        TEXT,
  link        VARCHAR(255),
  is_read     TINYINT(1) DEFAULT 0,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_notif_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_notif_user (user_id, is_read)
) ENGINE=InnoDB;

-- ---- Documents (Google Drive / local) ----
CREATE TABLE IF NOT EXISTS documents (
  id              CHAR(36) PRIMARY KEY,
  firm_id         CHAR(36) NOT NULL,
  client_id       CHAR(36) NULL,
  engagement_id   CHAR(36) NULL,
  drive_file_id   VARCHAR(120) NULL,
  storage         VARCHAR(20) DEFAULT 'local',
  local_path      VARCHAR(255) NULL,
  name            VARCHAR(255) NOT NULL,
  doc_type        ENUM('financial_statements','bank_statement','tra_document','tax_return',
                       'engagement_letter','proof_of_payment','invoice','payroll',
                       'wcf_nssf_pdpc','working_paper','other') DEFAULT 'other',
  year            INT NULL,
  mime_type       VARCHAR(120),
  size_bytes      BIGINT DEFAULT 0,
  web_link        VARCHAR(500) NULL,
  uploaded_by     CHAR(36) NULL,
  current_version INT DEFAULT 1,
  ocr_text        MEDIUMTEXT NULL,
  ocr_status      VARCHAR(20) DEFAULT 'none',
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at      DATETIME NULL,
  CONSTRAINT fk_doc_firm FOREIGN KEY (firm_id) REFERENCES firms(id) ON DELETE CASCADE,
  CONSTRAINT fk_doc_client FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL,
  CONSTRAINT fk_doc_eng FOREIGN KEY (engagement_id) REFERENCES engagements(id) ON DELETE SET NULL,
  INDEX idx_doc_client_year (client_id, year, doc_type),
  FULLTEXT KEY ft_doc (name, ocr_text)
) ENGINE=InnoDB;

-- ---- Document versions ----
CREATE TABLE IF NOT EXISTS document_versions (
  id                CHAR(36) PRIMARY KEY,
  document_id       CHAR(36) NOT NULL,
  version           INT NOT NULL,
  drive_revision_id VARCHAR(120) NULL,
  size_bytes        BIGINT DEFAULT 0,
  uploaded_by       CHAR(36) NULL,
  note              VARCHAR(255) NULL,
  created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_dv_doc FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ---- Calendar events ----
CREATE TABLE IF NOT EXISTS calendar_events (
  id            CHAR(36) PRIMARY KEY,
  firm_id       CHAR(36) NOT NULL,
  title         VARCHAR(220) NOT NULL,
  type          VARCHAR(40) DEFAULT 'event',
  client_id     CHAR(36) NULL,
  engagement_id CHAR(36) NULL,
  start_at      DATETIME NOT NULL,
  end_at        DATETIME NULL,
  all_day       TINYINT(1) DEFAULT 0,
  color         VARCHAR(20) NULL,
  created_by    CHAR(36) NULL,
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_cal_firm FOREIGN KEY (firm_id) REFERENCES firms(id) ON DELETE CASCADE,
  INDEX idx_cal_start (start_at)
) ENGINE=InnoDB;

-- ---- AI logs ----
CREATE TABLE IF NOT EXISTS ai_logs (
  id            CHAR(36) PRIMARY KEY,
  firm_id       CHAR(36) NOT NULL,
  user_id       CHAR(36) NULL,
  client_id     CHAR(36) NULL,
  engagement_id CHAR(36) NULL,
  feature       VARCHAR(40) DEFAULT 'chat',
  prompt        MEDIUMTEXT,
  response      MEDIUMTEXT,
  model         VARCHAR(60) NULL,
  tokens        INT NULL,
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_ai_firm FOREIGN KEY (firm_id) REFERENCES firms(id) ON DELETE CASCADE,
  INDEX idx_ai_user (user_id)
) ENGINE=InnoDB;

-- ---- Activity log (immutable audit trail) ----
CREATE TABLE IF NOT EXISTS activity_log (
  id            CHAR(36) PRIMARY KEY,
  firm_id       CHAR(36) NULL,
  user_id       CHAR(36) NULL,
  action        VARCHAR(80) NOT NULL,
  entity_type   VARCHAR(60),
  entity_id     CHAR(36) NULL,
  detail        JSON NULL,
  ip_address    VARCHAR(64),
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_act_entity (entity_type, entity_id),
  INDEX idx_act_user (user_id)
) ENGINE=InnoDB;

-- ---- App settings (Drive tokens, misc key/value) ----
CREATE TABLE IF NOT EXISTS app_settings (
  id          CHAR(36) PRIMARY KEY,
  firm_id     CHAR(36) NULL,
  `key`       VARCHAR(80) NOT NULL UNIQUE,
  `value`     MEDIUMTEXT,
  updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

SET FOREIGN_KEY_CHECKS = 1;

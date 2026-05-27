-- ============================================================
--  0001 — Extensions, shared helpers, firm & authentication
--  PostgreSQL 14+  (uses pgcrypto for gen_random_uuid & crypt)
-- ============================================================
CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid(), crypt(), gen_salt()
CREATE EXTENSION IF NOT EXISTS citext;      -- case-insensitive email

-- Shared trigger: maintain updated_at on UPDATE
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

-- ---- Firm (tenant) ----
CREATE TABLE firms (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       VARCHAR(180) NOT NULL,
  tin        VARCHAR(40),
  vrn        VARCHAR(40),
  address    VARCHAR(255),
  country    VARCHAR(60) DEFAULT 'Tanzania',
  logo_url   VARCHAR(255),
  settings   JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

-- ---- Roles & permissions (RBAC) ----
CREATE TABLE roles (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        VARCHAR(40) NOT NULL UNIQUE,            -- referenced by users.role
  description VARCHAR(200),
  is_system   SMALLINT NOT NULL DEFAULT 1,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE permissions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code        VARCHAR(60) NOT NULL UNIQUE,            -- e.g. 'client.create'
  module      VARCHAR(40) NOT NULL,
  description VARCHAR(200)
);

CREATE TABLE role_permissions (
  role_id       UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id UUID NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

-- ---- Users / staff ----
CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id       UUID NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  full_name     VARCHAR(160) NOT NULL,
  email         CITEXT NOT NULL UNIQUE,
  phone         VARCHAR(40),
  password_hash VARCHAR(255) NOT NULL,
  role          VARCHAR(40) NOT NULL DEFAULT 'Staff' REFERENCES roles(name) ON UPDATE CASCADE,
  status        VARCHAR(20) NOT NULL DEFAULT 'active'
                CHECK (status IN ('active','invited','suspended','on_leave')),
  profile_photo VARCHAR(255),                 -- a.k.a. avatar
  avatar_url    VARCHAR(255),
  last_login_at TIMESTAMPTZ,
  two_factor_enabled SMALLINT NOT NULL DEFAULT 0,
  two_factor_secret  VARCHAR(80),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at    TIMESTAMPTZ
);
CREATE INDEX idx_users_firm ON users(firm_id);
CREATE INDEX idx_users_role ON users(role);

-- ---- User sessions (refresh tokens) ----
CREATE TABLE user_sessions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  VARCHAR(255) NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  revoked_at  TIMESTAMPTZ,
  user_agent  VARCHAR(255),
  ip_address  VARCHAR(64),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_sessions_user ON user_sessions(user_id);
CREATE INDEX idx_sessions_token ON user_sessions(token_hash);

-- ---- Login history (audit of authentication attempts) ----
CREATE TABLE login_history (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID REFERENCES users(id) ON DELETE SET NULL,
  email       VARCHAR(180),
  success     SMALLINT NOT NULL DEFAULT 1,
  ip_address  VARCHAR(64),
  user_agent  VARCHAR(255),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_login_user ON login_history(user_id);

-- ---- Password reset tokens ----
CREATE TABLE password_reset_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  VARCHAR(255) NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_firms_upd BEFORE UPDATE ON firms FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_users_upd BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION set_updated_at();

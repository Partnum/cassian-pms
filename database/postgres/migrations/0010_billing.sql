-- ============================================================
--  0010 — SaaS billing & monetization
--  Plans, regional pricing, subscriptions, invoices, payments
--  (mobile-money-first), coupons, AI usage metering, add-ons,
--  and MRR snapshots for the revenue dashboard.
-- ============================================================

-- ---- Plans & regional pricing ----
CREATE TABLE plans (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code               VARCHAR(20) NOT NULL UNIQUE,
  name               VARCHAR(60) NOT NULL,
  tier               INT NOT NULL DEFAULT 0,
  monthly_price_usd  NUMERIC(10,2) NOT NULL DEFAULT 0,
  annual_price_usd   NUMERIC(10,2) NOT NULL DEFAULT 0,
  included_seats     INT NOT NULL DEFAULT 1,
  included_clients   INT,                       -- NULL = unlimited
  included_ai_credits INT NOT NULL DEFAULT 0,
  extra_seat_usd     NUMERIC(10,2) NOT NULL DEFAULT 0,
  features           JSONB DEFAULT '{}'::jsonb,
  is_active          SMALLINT NOT NULL DEFAULT 1,
  sort               INT NOT NULL DEFAULT 0,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE plan_prices (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id   UUID NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  currency  VARCHAR(8) NOT NULL,
  billing_interval VARCHAR(7) NOT NULL CHECK (billing_interval IN ('month','year')),
  amount    NUMERIC(18,2) NOT NULL,
  UNIQUE (plan_id, currency, billing_interval)
);

-- ---- Subscriptions ----
CREATE TABLE subscriptions (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id              UUID NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  plan_id              UUID NOT NULL REFERENCES plans(id),
  status               VARCHAR(12) NOT NULL DEFAULT 'trialing'
                         CHECK (status IN ('trialing','active','past_due','canceled')),
  billing_interval     VARCHAR(7) NOT NULL DEFAULT 'month' CHECK (billing_interval IN ('month','year')),
  currency             VARCHAR(8) NOT NULL DEFAULT 'TZS',
  seats                INT NOT NULL DEFAULT 1,
  trial_end            TIMESTAMPTZ,
  current_period_start TIMESTAMPTZ,
  current_period_end   TIMESTAMPTZ,
  cancel_at            TIMESTAMPTZ,
  canceled_at          TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_sub_firm ON subscriptions(firm_id);
CREATE INDEX idx_sub_status ON subscriptions(status);
CREATE TRIGGER trg_sub_upd BEFORE UPDATE ON subscriptions FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---- Invoices ----
CREATE TABLE invoices (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id         UUID NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  subscription_id UUID REFERENCES subscriptions(id) ON DELETE SET NULL,
  number          VARCHAR(40) UNIQUE,
  currency        VARCHAR(8) NOT NULL DEFAULT 'TZS',
  subtotal        NUMERIC(18,2) NOT NULL DEFAULT 0,
  tax             NUMERIC(18,2) NOT NULL DEFAULT 0,
  total           NUMERIC(18,2) NOT NULL DEFAULT 0,
  status          VARCHAR(14) NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft','open','paid','void','uncollectible')),
  issued_at       TIMESTAMPTZ,
  due_at          TIMESTAMPTZ,
  paid_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_inv_firm ON invoices(firm_id, status);

CREATE TABLE invoice_lines (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id  UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  kind        VARCHAR(14) NOT NULL DEFAULT 'subscription'
                CHECK (kind IN ('subscription','addon','usage','service','discount','tax')),
  description VARCHAR(220) NOT NULL,
  quantity    NUMERIC(12,2) NOT NULL DEFAULT 1,
  unit_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
  amount      NUMERIC(18,2) NOT NULL DEFAULT 0
);
CREATE INDEX idx_invline_inv ON invoice_lines(invoice_id);

-- ---- Payment methods & payments (mobile money + card + bank) ----
CREATE TABLE payment_methods (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id    UUID NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  type       VARCHAR(10) NOT NULL CHECK (type IN ('mpesa','airtel','tigo','halopesa','card','bank')),
  provider   VARCHAR(40),
  masked     VARCHAR(40),
  msisdn     VARCHAR(20),
  token      VARCHAR(120),
  is_default SMALLINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_pm_firm ON payment_methods(firm_id);

CREATE TABLE payments (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id      UUID NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  invoice_id   UUID REFERENCES invoices(id) ON DELETE SET NULL,
  method       VARCHAR(10) NOT NULL CHECK (method IN ('mpesa','airtel','tigo','halopesa','card','bank')),
  provider     VARCHAR(40),
  provider_ref VARCHAR(120),
  amount       NUMERIC(18,2) NOT NULL,
  currency     VARCHAR(8) NOT NULL DEFAULT 'TZS',
  status       VARCHAR(10) NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending','succeeded','failed','refunded')),
  msisdn       VARCHAR(20),
  failure_reason VARCHAR(200),
  paid_at      TIMESTAMPTZ,
  raw          JSONB,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_pay_firm ON payments(firm_id, status);
CREATE INDEX idx_pay_ref ON payments(provider_ref);

-- ---- Coupons / promo codes ----
CREATE TABLE coupons (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code            VARCHAR(40) NOT NULL UNIQUE,
  percent_off     NUMERIC(5,2),
  amount_off      NUMERIC(18,2),
  currency        VARCHAR(8),
  duration        VARCHAR(10) NOT NULL DEFAULT 'once' CHECK (duration IN ('once','repeating','forever')),
  duration_months INT,
  max_redemptions INT,
  redeemed        INT NOT NULL DEFAULT 0,
  expires_at      TIMESTAMPTZ,
  active          SMALLINT NOT NULL DEFAULT 1,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE subscription_discounts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id UUID NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
  coupon_id       UUID NOT NULL REFERENCES coupons(id) ON DELETE CASCADE,
  applied_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---- AI usage metering ----
CREATE TABLE usage_meters (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code            VARCHAR(30) NOT NULL UNIQUE,
  name            VARCHAR(80) NOT NULL,
  unit            VARCHAR(20) NOT NULL,
  credits_per_unit INT NOT NULL DEFAULT 1,
  unit_price_usd  NUMERIC(10,4) NOT NULL DEFAULT 0
);

CREATE TABLE usage_records (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id         UUID NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  subscription_id UUID REFERENCES subscriptions(id) ON DELETE SET NULL,
  meter_code      VARCHAR(30) NOT NULL,
  quantity        NUMERIC(12,2) NOT NULL DEFAULT 1,
  credits         INT NOT NULL DEFAULT 0,
  unit_amount_usd NUMERIC(10,4) NOT NULL DEFAULT 0,
  occurred_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_usage_firm ON usage_records(firm_id, occurred_at);

-- ---- Add-ons ----
CREATE TABLE addons (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code           VARCHAR(30) NOT NULL UNIQUE,
  name           VARCHAR(80) NOT NULL,
  unit           VARCHAR(20) NOT NULL,
  unit_price_usd NUMERIC(10,2) NOT NULL DEFAULT 0,
  is_active      SMALLINT NOT NULL DEFAULT 1
);

CREATE TABLE subscription_addons (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id UUID NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
  addon_code      VARCHAR(30) NOT NULL,
  quantity        NUMERIC(12,2) NOT NULL DEFAULT 1,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---- MRR snapshots (revenue dashboard) ----
CREATE TABLE mrr_snapshots (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id         UUID REFERENCES firms(id) ON DELETE CASCADE,  -- NULL = platform-wide total
  snapshot_date   DATE NOT NULL,
  mrr             NUMERIC(18,2) NOT NULL DEFAULT 0,
  arr             NUMERIC(18,2) NOT NULL DEFAULT 0,
  new_mrr         NUMERIC(18,2) NOT NULL DEFAULT 0,
  expansion_mrr   NUMERIC(18,2) NOT NULL DEFAULT 0,
  contraction_mrr NUMERIC(18,2) NOT NULL DEFAULT 0,
  churned_mrr     NUMERIC(18,2) NOT NULL DEFAULT 0,
  active_subs     INT NOT NULL DEFAULT 0,
  currency        VARCHAR(8) NOT NULL DEFAULT 'USD',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_mrr_date ON mrr_snapshots(snapshot_date);

-- ============================================================
--  Seed: plans, regional prices, usage meters, add-ons
-- ============================================================
INSERT INTO plans (code, name, tier, monthly_price_usd, annual_price_usd, included_seats, included_clients, included_ai_credits, extra_seat_usd, sort, features) VALUES
 ('solo','Solo',1,15,150,1,5,50,0,1,'{"drive":false,"ai":"limited","white_label":false}'),
 ('starter','Starter',2,39,390,3,15,150,9,2,'{"drive":true,"ai":"limited","rbac":"basic"}'),
 ('professional','Professional',3,99,990,10,60,600,9,3,'{"drive":true,"ai":true,"risk_centre":true,"rbac":true}'),
 ('enterprise','Enterprise',4,279,2790,9999,NULL,3000,8,4,'{"drive":true,"ai":"advanced","white_label":true,"rbac":"advanced","priority_support":true}');

-- Regional monthly + annual price points (indicative; annual = 10x monthly)
INSERT INTO plan_prices (plan_id, currency, billing_interval, amount)
SELECT p.id, v.currency, v.bint, v.amount FROM plans p JOIN (VALUES
  ('solo','USD','month',15),('solo','USD','year',150),('solo','TZS','month',39000),('solo','TZS','year',390000),
  ('starter','USD','month',39),('starter','USD','year',390),('starter','TZS','month',99000),('starter','TZS','year',990000),
  ('starter','KES','month',4900),('starter','UGX','month',145000),('starter','RWF','month',55000),('starter','ZMW','month',990),
  ('professional','USD','month',99),('professional','USD','year',990),('professional','TZS','month',259000),('professional','TZS','year',2590000),
  ('professional','KES','month',12900),('professional','UGX','month',369000),('professional','RWF','month',139000),('professional','ZMW','month',2590),
  ('enterprise','USD','month',279),('enterprise','USD','year',2790),('enterprise','TZS','month',729000),('enterprise','TZS','year',7290000)
) AS v(code,currency,bint,amount) ON p.code=v.code;

INSERT INTO usage_meters (code, name, unit, credits_per_unit, unit_price_usd) VALUES
 ('ocr_page','OCR page','page',1,0.02),
 ('ai_doc_review','AI document review','document',3,0.06),
 ('ai_analysis','AI audit analysis / risk run','run',4,0.08),
 ('compliance_check','Compliance check','check',2,0.04),
 ('ai_report','AI report generation','report',10,0.20),
 ('assistant_msg','Assistant chat message','message',1,0.02);

INSERT INTO addons (code, name, unit, unit_price_usd) VALUES
 ('extra_seat','Additional staff seat','seat/month',9),
 ('extra_clients_25','+25 active clients','pack/month',19),
 ('storage_50gb','+50 GB document storage','pack/month',8),
 ('premium_analytics','Premium analytics','firm/month',29),
 ('api_access','API access','firm/month',49),
 ('esign_100','E-signature pack (100)','pack',15),
 ('ai_credits_500','AI credits top-up (500)','pack',9),
 ('ai_credits_2500','AI credits top-up (2,500)','pack',40);

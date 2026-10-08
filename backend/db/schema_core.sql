-- =============================================================
-- ArthSathi PostgreSQL Schema (ASCII-safe, no Unicode literals)
-- Version: 1.0
-- =============================================================

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =============================================================
-- ENUM TYPES
-- =============================================================

DO $$ BEGIN
  CREATE TYPE interaction_mode AS ENUM ('text', 'voice');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE gender_type AS ENUM ('male', 'female', 'transgender', 'other', 'prefer_not_to_say');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE caste_category AS ENUM ('general', 'obc', 'sc', 'st', 'nt', 'vjnt', 'other');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE occupation_type AS ENUM (
    'farmer', 'farm_laborer', 'artisan', 'self_employed',
    'daily_wage', 'domestic_worker', 'fisherman', 'weaver',
    'construction_worker', 'street_vendor', 'unemployed', 'other'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE scheme_category AS ENUM (
    'agriculture', 'health', 'education', 'housing',
    'social_security', 'employment', 'women_welfare',
    'minority_welfare', 'disability', 'insurance', 'other'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE match_status AS ENUM ('shown', 'clicked', 'applied', 'dismissed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE language_code AS ENUM ('hi', 'mr', 'ta', 'te', 'bn', 'en');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE risk_level AS ENUM ('low', 'medium', 'high');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- =============================================================
-- TABLE: users
-- =============================================================
CREATE TABLE IF NOT EXISTS users (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name           VARCHAR(200),
  phone_number        VARCHAR(15) UNIQUE,
  aadhaar_hash        CHAR(64),
  verified            BOOLEAN NOT NULL DEFAULT FALSE,
  state               VARCHAR(100),
  district            VARCHAR(100),
  village             VARCHAR(200),
  pincode             CHAR(6),
  preferred_language  language_code NOT NULL DEFAULT 'hi',
  interaction_mode    interaction_mode NOT NULL DEFAULT 'voice',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT phone_format CHECK (phone_number ~ '^\+[1-9]\d{9,14}$' OR phone_number IS NULL)
);

CREATE INDEX IF NOT EXISTS idx_users_phone    ON users(phone_number);
CREATE INDEX IF NOT EXISTS idx_users_state    ON users(state);
CREATE INDEX IF NOT EXISTS idx_users_language ON users(preferred_language);

-- =============================================================
-- TABLE: financial_profiles
-- =============================================================
CREATE TABLE IF NOT EXISTS financial_profiles (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  age                   SMALLINT CHECK (age > 0 AND age < 130),
  gender                gender_type,
  caste_category        caste_category,
  occupation            occupation_type,
  is_disabled           BOOLEAN DEFAULT FALSE,
  disability_percent    SMALLINT CHECK (disability_percent BETWEEN 0 AND 100),
  monthly_income        NUMERIC(12, 2) CHECK (monthly_income >= 0),
  annual_income         NUMERIC(12, 2) CHECK (annual_income >= 0),
  total_debts           NUMERIC(12, 2) DEFAULT 0,
  land_holding_acres    NUMERIC(6, 2) DEFAULT 0,
  num_dependents        SMALLINT DEFAULT 0,
  has_bank_account      BOOLEAN DEFAULT FALSE,
  has_jan_dhan_account  BOOLEAN DEFAULT FALSE,
  ration_card_type      VARCHAR(20),
  financial_goal        VARCHAR(500),
  goal_amount           NUMERIC(12, 2),
  goal_timeframe_months SMALLINT,
  urgency_level         SMALLINT CHECK (urgency_level BETWEEN 1 AND 5),
  completed_at          TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT one_profile_per_user UNIQUE (user_id)
);

CREATE INDEX IF NOT EXISTS idx_fp_user        ON financial_profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_fp_income      ON financial_profiles(annual_income);
CREATE INDEX IF NOT EXISTS idx_fp_caste       ON financial_profiles(caste_category);
CREATE INDEX IF NOT EXISTS idx_fp_occupation  ON financial_profiles(occupation);

-- =============================================================
-- TABLE: schemes
-- =============================================================
CREATE TABLE IF NOT EXISTS schemes (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stable_id             VARCHAR(200) UNIQUE NOT NULL,
  name_en               VARCHAR(500) NOT NULL,
  name_hi               VARCHAR(500),
  name_mr               VARCHAR(500),
  name_ta               VARCHAR(500),
  name_te               VARCHAR(500),
  name_bn               VARCHAR(500),
  description_en        TEXT,
  description_hi        TEXT,
  min_age               SMALLINT,
  max_age               SMALLINT,
  min_annual_income     NUMERIC(12, 2),
  max_annual_income     NUMERIC(12, 2),
  eligible_states       TEXT[],
  eligible_genders      gender_type[],
  eligible_castes       caste_category[],
  eligible_occupations  occupation_type[],
  requires_bank_account BOOLEAN DEFAULT FALSE,
  requires_land         BOOLEAN DEFAULT FALSE,
  category              scheme_category NOT NULL DEFAULT 'other',
  benefit_amount        NUMERIC(12, 2),
  benefit_description   TEXT,
  tags                  TEXT[],
  source_url            TEXT,
  ministry              VARCHAR(300),
  application_url       TEXT,
  last_scraped_at       TIMESTAMPTZ,
  is_active             BOOLEAN NOT NULL DEFAULT TRUE,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_schemes_stable_id   ON schemes(stable_id);
CREATE INDEX IF NOT EXISTS idx_schemes_category    ON schemes(category);
CREATE INDEX IF NOT EXISTS idx_schemes_active      ON schemes(is_active);
CREATE INDEX IF NOT EXISTS idx_schemes_income      ON schemes(min_annual_income, max_annual_income);
CREATE INDEX IF NOT EXISTS idx_schemes_age         ON schemes(min_age, max_age);
CREATE INDEX IF NOT EXISTS idx_schemes_tags        ON schemes USING gin(tags);
CREATE INDEX IF NOT EXISTS idx_schemes_states      ON schemes USING gin(eligible_states);

-- =============================================================
-- TABLE: insurance_policies
-- =============================================================
CREATE TABLE IF NOT EXISTS insurance_policies (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stable_id             VARCHAR(200) UNIQUE NOT NULL,
  name_en               VARCHAR(500) NOT NULL,
  name_hi               VARCHAR(500),
  name_mr               VARCHAR(500),
  name_ta               VARCHAR(500),
  name_te               VARCHAR(500),
  name_bn               VARCHAR(500),
  description_en        TEXT,
  description_hi        TEXT,
  min_age               SMALLINT,
  max_age               SMALLINT,
  min_annual_income     NUMERIC(12, 2),
  max_annual_income     NUMERIC(12, 2),
  eligible_states       TEXT[],
  eligible_genders      gender_type[],
  eligible_castes       caste_category[],
  requires_bank_account BOOLEAN DEFAULT TRUE,
  requires_jan_dhan     BOOLEAN DEFAULT FALSE,
  category              scheme_category NOT NULL DEFAULT 'insurance',
  annual_premium        NUMERIC(10, 2),
  coverage_amount       NUMERIC(12, 2),
  coverage_type         VARCHAR(200),
  claim_process         TEXT,
  tags                  TEXT[],
  source_url            TEXT,
  administered_by       VARCHAR(300),
  application_url       TEXT,
  last_scraped_at       TIMESTAMPTZ,
  is_active             BOOLEAN NOT NULL DEFAULT TRUE,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_insurance_stable_id ON insurance_policies(stable_id);
CREATE INDEX IF NOT EXISTS idx_insurance_category  ON insurance_policies(category);
CREATE INDEX IF NOT EXISTS idx_insurance_active    ON insurance_policies(is_active);
CREATE INDEX IF NOT EXISTS idx_insurance_premium   ON insurance_policies(annual_premium);
CREATE INDEX IF NOT EXISTS idx_insurance_tags      ON insurance_policies USING gin(tags);

-- =============================================================
-- TABLE: user_scheme_matches
-- =============================================================
CREATE TABLE IF NOT EXISTS user_scheme_matches (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scheme_id        UUID NOT NULL REFERENCES schemes(id) ON DELETE CASCADE,
  score            NUMERIC(6, 4) NOT NULL,
  rank_position    SMALLINT,
  status           match_status NOT NULL DEFAULT 'shown',
  shown_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  clicked_at       TIMESTAMPTZ,
  applied_at       TIMESTAMPTZ,
  dismissed_at     TIMESTAMPTZ,
  profile_snapshot JSONB,
  CONSTRAINT unique_user_scheme UNIQUE (user_id, scheme_id, shown_at)
);

CREATE INDEX IF NOT EXISTS idx_usm_user     ON user_scheme_matches(user_id);
CREATE INDEX IF NOT EXISTS idx_usm_scheme   ON user_scheme_matches(scheme_id);
CREATE INDEX IF NOT EXISTS idx_usm_status   ON user_scheme_matches(status);
CREATE INDEX IF NOT EXISTS idx_usm_shown    ON user_scheme_matches(shown_at);

-- =============================================================
-- TABLE: user_insurance_matches
-- =============================================================
CREATE TABLE IF NOT EXISTS user_insurance_matches (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  policy_id        UUID NOT NULL REFERENCES insurance_policies(id) ON DELETE CASCADE,
  score            NUMERIC(6, 4) NOT NULL,
  rank_position    SMALLINT,
  status           match_status NOT NULL DEFAULT 'shown',
  shown_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  clicked_at       TIMESTAMPTZ,
  applied_at       TIMESTAMPTZ,
  dismissed_at     TIMESTAMPTZ,
  profile_snapshot JSONB,
  CONSTRAINT unique_user_insurance UNIQUE (user_id, policy_id, shown_at)
);

CREATE INDEX IF NOT EXISTS idx_uim_user     ON user_insurance_matches(user_id);
CREATE INDEX IF NOT EXISTS idx_uim_policy   ON user_insurance_matches(policy_id);
CREATE INDEX IF NOT EXISTS idx_uim_status   ON user_insurance_matches(status);

-- =============================================================
-- TABLE: documents
-- =============================================================
CREATE TABLE IF NOT EXISTS documents (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  original_filename     VARCHAR(500),
  file_path             TEXT,
  mime_type             VARCHAR(100),
  raw_ocr_text          TEXT,
  ocr_confidence        NUMERIC(5, 2),
  ocr_language          language_code,
  summary_text          TEXT,
  summary_language      language_code,
  risk_flags            JSONB,
  risk_level            risk_level,
  llm_model_used        VARCHAR(100),
  conversation_history  JSONB,
  processed_at          TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_docs_user      ON documents(user_id);
CREATE INDEX IF NOT EXISTS idx_docs_risk      ON documents(risk_level);
CREATE INDEX IF NOT EXISTS idx_docs_created   ON documents(created_at);

-- =============================================================
-- TABLE: scraping_log
-- =============================================================
CREATE TABLE IF NOT EXISTS scraping_log (
  id              SERIAL PRIMARY KEY,
  run_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source          VARCHAR(200) NOT NULL,
  run_type        VARCHAR(50) DEFAULT 'scheduled',
  rows_added      INTEGER DEFAULT 0,
  rows_updated    INTEGER DEFAULT 0,
  rows_failed     INTEGER DEFAULT 0,
  success         BOOLEAN NOT NULL,
  error_message   TEXT,
  duration_secs   NUMERIC(8, 2),
  details         JSONB
);

CREATE INDEX IF NOT EXISTS idx_scraping_log_run_at  ON scraping_log(run_at DESC);
CREATE INDEX IF NOT EXISTS idx_scraping_log_source  ON scraping_log(source);
CREATE INDEX IF NOT EXISTS idx_scraping_log_success ON scraping_log(success);

-- =============================================================
-- TABLE: interaction_events
-- =============================================================
CREATE TABLE IF NOT EXISTS interaction_events (
  id            BIGSERIAL PRIMARY KEY,
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_type    VARCHAR(50) NOT NULL,
  entity_type   VARCHAR(20) NOT NULL,
  entity_id     UUID NOT NULL,
  score_at_time NUMERIC(6, 4),
  rank_at_time  SMALLINT,
  session_id    UUID,
  device_type   VARCHAR(20),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ie_user        ON interaction_events(user_id);
CREATE INDEX IF NOT EXISTS idx_ie_entity      ON interaction_events(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_ie_event_type  ON interaction_events(event_type);
CREATE INDEX IF NOT EXISTS idx_ie_created     ON interaction_events(created_at DESC);

-- =============================================================
-- TRIGGERS: auto-update updated_at timestamps
-- =============================================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_users_updated ON users;
CREATE TRIGGER trg_users_updated
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_fp_updated ON financial_profiles;
CREATE TRIGGER trg_fp_updated
  BEFORE UPDATE ON financial_profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_schemes_updated ON schemes;
CREATE TRIGGER trg_schemes_updated
  BEFORE UPDATE ON schemes
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_insurance_updated ON insurance_policies;
CREATE TRIGGER trg_insurance_updated
  BEFORE UPDATE ON insurance_policies
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_documents_updated ON documents;
CREATE TRIGGER trg_documents_updated
  BEFORE UPDATE ON documents
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

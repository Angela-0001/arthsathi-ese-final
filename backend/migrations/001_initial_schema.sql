-- =============================================================
-- ArthSathi Migration 001 — Full Production Schema
-- Run order: forward only (no down migration for initial)
-- =============================================================

-- Enable extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";   -- for fuzzy text search on scheme names
CREATE EXTENSION IF NOT EXISTS "unaccent";  -- normalize accented chars in search

-- =============================================================
-- ENUMERATIONS
-- =============================================================

-- Recreate cleanly (idempotent via DO blocks)
DO $$ BEGIN CREATE TYPE interaction_mode_t AS ENUM ('text','voice'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE gender_t AS ENUM ('male','female','transgender','prefer_not_to_say'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE caste_t AS ENUM ('general','obc','sc','st','nt','vjnt','ews','other'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE religion_t AS ENUM ('hindu','muslim','christian','sikh','buddhist','jain','parsi','other','prefer_not_to_say'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE occupation_t AS ENUM (
  'farmer','marginal_farmer','farm_laborer','fisherman','weaver','artisan','potter',
  'self_employed','street_vendor','small_trader',
  'daily_wage','construction_worker','domestic_worker','factory_worker',
  'student','teacher','government_employee','private_employee',
  'unemployed','homemaker','retired','other'
); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE ration_card_t AS ENUM (
  'aay',          -- Antyodaya Anna Yojana (poorest of poor, yellow/pink)
  'phh',          -- Priority Household (BPL)
  'nphh',         -- Non-Priority Household (APL)
  'annapurna',    -- For destitute senior citizens
  'state_other',  -- State-specific variants
  'none',
  'applied'       -- Applied but not received
); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE scheme_level_t AS ENUM ('central','state','district','local'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE benefit_type_t AS ENUM (
  'cash_direct','loan','subsidy','scholarship','insurance',
  'service','equipment','training','pension','housing','other'
); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE eligibility_status_t AS ENUM ('eligible','likely','ineligible','unknown'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE match_action_t AS ENUM ('impression','click','listen','save','apply','dismiss','share'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE language_t AS ENUM ('hi','mr','ta','te','bn','en'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE created_via_t AS ENUM ('web','ivr','android','ios'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE disability_t AS ENUM (
  'none','visual','hearing','locomotor','mental_illness',
  'intellectual','multiple','other'
); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE education_t AS ENUM (
  'illiterate','primary','middle','matriculation','higher_secondary',
  'graduate','postgraduate','professional','other'
); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE marital_t AS ENUM ('single','married','widowed','divorced','separated'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE residence_t AS ENUM ('rural','urban','semi_urban'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE risk_severity_t AS ENUM ('low','medium','high','critical'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- =============================================================
-- TABLE: users
-- =============================================================
CREATE TABLE IF NOT EXISTS users (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Identity (never store raw Aadhaar)
  full_name           VARCHAR(200),
  phone_number        VARCHAR(15),
  phone_verified      BOOLEAN DEFAULT FALSE,
  aadhaar_last4       CHAR(4),                     -- last 4 digits only
  aadhaar_hash        CHAR(64),                     -- SHA-256 salted hash, if needed

  -- Preferences
  preferred_language  language_t NOT NULL DEFAULT 'hi',
  interaction_mode    interaction_mode_t NOT NULL DEFAULT 'voice',

  -- Location
  state               VARCHAR(100),
  district            VARCHAR(100),
  village_town        VARCHAR(200),
  pincode             CHAR(6),
  residence_type      residence_t,

  -- Account
  created_via         created_via_t NOT NULL DEFAULT 'web',
  consent_given_at    TIMESTAMPTZ,
  is_active           BOOLEAN DEFAULT TRUE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT phone_format CHECK (
    phone_number IS NULL OR phone_number ~ '^\+[1-9]\d{9,14}$'
  ),
  CONSTRAINT aadhaar_last4_format CHECK (
    aadhaar_last4 IS NULL OR aadhaar_last4 ~ '^\d{4}$'
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_phone_unique
  ON users(phone_number) WHERE phone_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_state    ON users(state);
CREATE INDEX IF NOT EXISTS idx_users_language ON users(preferred_language);
CREATE INDEX IF NOT EXISTS idx_users_created  ON users(created_at DESC);

-- =============================================================
-- TABLE: financial_profiles
-- =============================================================
CREATE TABLE IF NOT EXISTS financial_profiles (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Demographics
  age                      SMALLINT CHECK (age BETWEEN 1 AND 120),
  gender                   gender_t,
  marital_status           marital_t,
  religion                 religion_t,
  caste_category           caste_t,
  is_minority              BOOLEAN DEFAULT FALSE,

  -- Occupation
  occupation               occupation_t,
  sub_occupation           VARCHAR(200),     -- e.g. "vegetable vendor", "paddy farmer"

  -- Economic (all amounts INR)
  monthly_income           NUMERIC(12,2) CHECK (monthly_income >= 0),
  annual_income            NUMERIC(12,2) CHECK (annual_income >= 0),
  family_monthly_income    NUMERIC(12,2),
  family_annual_income     NUMERIC(12,2),
  total_debts              NUMERIC(12,2) DEFAULT 0,
  land_holding_acres       NUMERIC(6,2)  DEFAULT 0,
  num_dependents           SMALLINT DEFAULT 0,

  -- Poverty indicators
  is_bpl                   BOOLEAN DEFAULT FALSE,
  ration_card_type         ration_card_t,
  ration_card_state_label  VARCHAR(100),     -- state-specific label (e.g. "Orange Card" in Maharashtra)
  ration_card_member_count SMALLINT,

  -- Documents held
  has_bank_account         BOOLEAN DEFAULT FALSE,
  has_jan_dhan_account     BOOLEAN DEFAULT FALSE,
  has_aadhaar              BOOLEAN DEFAULT FALSE,
  has_kisan_credit_card    BOOLEAN DEFAULT FALSE,

  -- Family
  has_girl_child           BOOLEAN DEFAULT FALSE,
  num_girl_children        SMALLINT DEFAULT 0,
  is_widow                 BOOLEAN DEFAULT FALSE,
  is_divorcee              BOOLEAN DEFAULT FALSE,
  is_senior_citizen        BOOLEAN DEFAULT FALSE,

  -- Education
  education_level          education_t,
  is_student               BOOLEAN DEFAULT FALSE,
  student_class_level      VARCHAR(50),

  -- Disability
  has_disability           BOOLEAN DEFAULT FALSE,
  disability_type          disability_t,
  disability_percentage    SMALLINT CHECK (disability_percentage BETWEEN 0 AND 100),
  has_disability_certificate BOOLEAN DEFAULT FALSE,

  -- Goal
  financial_goal           VARCHAR(100),     -- canonical goal key: 'house','crop','health','education', etc.
  goal_description         TEXT,             -- user's own words
  goal_amount              NUMERIC(12,2),
  goal_timeframe_months    SMALLINT,
  urgency_level            SMALLINT CHECK (urgency_level BETWEEN 1 AND 5),

  -- Profile metadata
  profile_completeness     SMALLINT DEFAULT 0, -- 0–100, updated by trigger
  completed_at             TIMESTAMPTZ,
  last_answered_question   VARCHAR(100),     -- for resuming onboarding
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT one_profile_per_user UNIQUE (user_id)
);

CREATE INDEX IF NOT EXISTS idx_fp_user       ON financial_profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_fp_state      ON financial_profiles(user_id); -- via users join
CREATE INDEX IF NOT EXISTS idx_fp_income     ON financial_profiles(annual_income);
CREATE INDEX IF NOT EXISTS idx_fp_caste      ON financial_profiles(caste_category);
CREATE INDEX IF NOT EXISTS idx_fp_occupation ON financial_profiles(occupation);
CREATE INDEX IF NOT EXISTS idx_fp_ration     ON financial_profiles(ration_card_type);

-- =============================================================
-- TABLE: schemes
-- =============================================================
CREATE TABLE IF NOT EXISTS schemes (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Stable identifier from source (slug from myscheme.gov.in)
  source_id             VARCHAR(300) NOT NULL,
  source_slug           VARCHAR(300),
  source_url            TEXT,
  content_hash          CHAR(64),             -- SHA-256 of raw_payload; detect changes

  -- Names (JSONB for any language without schema change)
  name                  JSONB NOT NULL DEFAULT '{}',  -- {"en":"...", "hi":"...", ...}
  short_name            JSONB DEFAULT '{}',

  -- Descriptions (JSONB for multi-language)
  description           JSONB DEFAULT '{}',
  benefits_text         JSONB DEFAULT '{}',
  eligibility_text      JSONB DEFAULT '{}',  -- raw eligibility text per language

  -- Classification
  level                 scheme_level_t NOT NULL DEFAULT 'central',
  applicable_states     TEXT[],              -- NULL = all India; array of state names
  ministry              VARCHAR(400),
  department            VARCHAR(400),
  category              VARCHAR(100),        -- agriculture, health, education, etc.
  sub_category          VARCHAR(100),
  tags                  TEXT[],

  -- Benefit
  benefit_type          benefit_type_t,
  benefit_amount_min    NUMERIC(12,2),
  benefit_amount_max    NUMERIC(12,2),
  benefit_frequency     VARCHAR(100),        -- 'one_time', 'annual', 'monthly', 'ongoing'
  benefit_description   JSONB DEFAULT '{}',

  -- Application
  application_process   JSONB DEFAULT '{}',
  documents_required    JSONB DEFAULT '[]',  -- array of document names
  application_url       TEXT,
  application_mode      TEXT[],             -- ['online','offline','csc','bank']
  application_deadline  DATE,
  enrollment_start      DATE,
  enrollment_end        DATE,

  -- =====================
  -- STRUCTURED ELIGIBILITY CRITERIA
  -- (NULL on any field = no restriction)
  -- =====================
  min_age               SMALLINT,
  max_age               SMALLINT,
  eligible_genders      gender_t[],
  eligible_castes       caste_t[],
  eligible_occupations  occupation_t[],
  eligible_states_exact TEXT[],             -- for state schemes
  eligible_religions    religion_t[],
  eligible_ration_cards ration_card_t[],
  eligible_education    education_t[],
  eligible_residence    residence_t[],

  min_annual_income     NUMERIC(12,2),
  max_annual_income     NUMERIC(12,2),
  max_family_income     NUMERIC(12,2),
  max_land_holding_acres NUMERIC(6,2),

  requires_bank_account   BOOLEAN DEFAULT FALSE,
  requires_aadhaar        BOOLEAN DEFAULT FALSE,
  requires_bpl            BOOLEAN DEFAULT FALSE,
  requires_disability     BOOLEAN DEFAULT FALSE,
  min_disability_percent  SMALLINT,
  requires_girl_child     BOOLEAN DEFAULT FALSE,
  requires_widow          BOOLEAN DEFAULT FALSE,
  requires_minority       BOOLEAN DEFAULT FALSE,
  requires_student        BOOLEAN DEFAULT FALSE,
  requires_farmer         BOOLEAN DEFAULT FALSE,

  -- Full structured criteria including anything the rules couldn't parse
  criteria_json         JSONB DEFAULT '{}',

  -- Parsing metadata
  parse_confidence      NUMERIC(4,2) DEFAULT 0,  -- 0.0–1.0 how much was parsed
  raw_payload           JSONB,                    -- original API response

  -- Freshness
  first_scraped_at      TIMESTAMPTZ,
  last_scraped_at       TIMESTAMPTZ,
  is_active             BOOLEAN NOT NULL DEFAULT TRUE,

  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT schemes_source_unique UNIQUE (source_id)
);

-- B-tree indexes for filter columns
CREATE INDEX IF NOT EXISTS idx_schemes_level    ON schemes(level);
CREATE INDEX IF NOT EXISTS idx_schemes_category ON schemes(category);
CREATE INDEX IF NOT EXISTS idx_schemes_active   ON schemes(is_active);
CREATE INDEX IF NOT EXISTS idx_schemes_min_age  ON schemes(min_age);
CREATE INDEX IF NOT EXISTS idx_schemes_max_age  ON schemes(max_age);
CREATE INDEX IF NOT EXISTS idx_schemes_income   ON schemes(min_annual_income, max_annual_income);
CREATE INDEX IF NOT EXISTS idx_schemes_scraped  ON schemes(last_scraped_at DESC);

-- GIN indexes for array and JSONB columns
CREATE INDEX IF NOT EXISTS idx_schemes_tags       ON schemes USING gin(tags);
CREATE INDEX IF NOT EXISTS idx_schemes_states     ON schemes USING gin(applicable_states);
CREATE INDEX IF NOT EXISTS idx_schemes_castes     ON schemes USING gin(eligible_castes);
CREATE INDEX IF NOT EXISTS idx_schemes_occupations ON schemes USING gin(eligible_occupations);
CREATE INDEX IF NOT EXISTS idx_schemes_ration     ON schemes USING gin(eligible_ration_cards);
CREATE INDEX IF NOT EXISTS idx_schemes_criteria   ON schemes USING gin(criteria_json);
CREATE INDEX IF NOT EXISTS idx_schemes_name_gin   ON schemes USING gin(name);

-- Full text index on scheme names (English) for search
CREATE INDEX IF NOT EXISTS idx_schemes_name_fts ON schemes
  USING gin(to_tsvector('english', COALESCE(name->>'en', '')));

-- =============================================================
-- TABLE: insurance_policies  (mirrors schemes structure)
-- =============================================================
CREATE TABLE IF NOT EXISTS insurance_policies (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id             VARCHAR(300) NOT NULL UNIQUE,
  source_url            TEXT,
  content_hash          CHAR(64),

  name                  JSONB NOT NULL DEFAULT '{}',
  description           JSONB DEFAULT '{}',
  eligibility_text      JSONB DEFAULT '{}',

  level                 scheme_level_t DEFAULT 'central',
  applicable_states     TEXT[],
  ministry              VARCHAR(400),
  administered_by       VARCHAR(400),
  category              VARCHAR(100),
  tags                  TEXT[],

  benefit_type          benefit_type_t DEFAULT 'insurance',
  annual_premium        NUMERIC(10,2),
  coverage_amount       NUMERIC(12,2),
  coverage_type         VARCHAR(200),
  claim_process         JSONB DEFAULT '{}',
  enrollment_window     JSONB DEFAULT '{}',  -- {"start_month":6,"end_month":5}

  -- Eligibility (same pattern as schemes)
  min_age               SMALLINT,
  max_age               SMALLINT,
  eligible_genders      gender_t[],
  eligible_castes       caste_t[],
  eligible_ration_cards ration_card_t[],
  min_annual_income     NUMERIC(12,2),
  max_annual_income     NUMERIC(12,2),
  requires_bank_account BOOLEAN DEFAULT TRUE,
  requires_aadhaar      BOOLEAN DEFAULT FALSE,
  requires_jan_dhan     BOOLEAN DEFAULT FALSE,
  requires_bpl          BOOLEAN DEFAULT FALSE,

  criteria_json         JSONB DEFAULT '{}',
  parse_confidence      NUMERIC(4,2) DEFAULT 0,
  raw_payload           JSONB,

  application_url       TEXT,
  documents_required    JSONB DEFAULT '[]',

  first_scraped_at      TIMESTAMPTZ,
  last_scraped_at       TIMESTAMPTZ,
  is_active             BOOLEAN NOT NULL DEFAULT TRUE,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ins_active   ON insurance_policies(is_active);
CREATE INDEX IF NOT EXISTS idx_ins_category ON insurance_policies(category);
CREATE INDEX IF NOT EXISTS idx_ins_premium  ON insurance_policies(annual_premium);
CREATE INDEX IF NOT EXISTS idx_ins_tags     ON insurance_policies USING gin(tags);
CREATE INDEX IF NOT EXISTS idx_ins_castes   ON insurance_policies USING gin(eligible_castes);
CREATE INDEX IF NOT EXISTS idx_ins_ration   ON insurance_policies USING gin(eligible_ration_cards);

-- =============================================================
-- TABLE: user_scheme_matches
-- =============================================================
CREATE TABLE IF NOT EXISTS user_scheme_matches (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scheme_id         UUID NOT NULL REFERENCES schemes(id) ON DELETE CASCADE,

  -- Score breakdown (all 8 features)
  score             NUMERIC(7,5) NOT NULL,
  rank_position     SMALLINT,
  score_breakdown   JSONB,         -- {"f1_goal_relevance":0.8,"f2_financial":0.6,...}
  eligibility_status eligibility_status_t DEFAULT 'eligible',
  missing_criteria  TEXT[],        -- criteria with UNKNOWN status
  explain_text      TEXT,          -- human-readable reason in user's language

  -- Interaction
  session_id        UUID,
  status            match_action_t DEFAULT 'impression',
  shown_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  clicked_at        TIMESTAMPTZ,
  listened_at       TIMESTAMPTZ,
  saved_at          TIMESTAMPTZ,
  applied_at        TIMESTAMPTZ,
  dismissed_at      TIMESTAMPTZ,

  -- Snapshot for learning
  profile_snapshot  JSONB,         -- user profile at match time
  weights_snapshot  JSONB,         -- weights used at match time

  CONSTRAINT unique_match_session UNIQUE (user_id, scheme_id, session_id)
);

CREATE INDEX IF NOT EXISTS idx_usm_user      ON user_scheme_matches(user_id);
CREATE INDEX IF NOT EXISTS idx_usm_scheme    ON user_scheme_matches(scheme_id);
CREATE INDEX IF NOT EXISTS idx_usm_status    ON user_scheme_matches(status);
CREATE INDEX IF NOT EXISTS idx_usm_shown     ON user_scheme_matches(shown_at DESC);
CREATE INDEX IF NOT EXISTS idx_usm_session   ON user_scheme_matches(session_id);

-- =============================================================
-- TABLE: user_insurance_matches
-- =============================================================
CREATE TABLE IF NOT EXISTS user_insurance_matches (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  policy_id         UUID NOT NULL REFERENCES insurance_policies(id) ON DELETE CASCADE,

  score             NUMERIC(7,5) NOT NULL,
  rank_position     SMALLINT,
  score_breakdown   JSONB,
  eligibility_status eligibility_status_t DEFAULT 'eligible',
  missing_criteria  TEXT[],
  explain_text      TEXT,

  session_id        UUID,
  status            match_action_t DEFAULT 'impression',
  shown_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  clicked_at        TIMESTAMPTZ,
  listened_at       TIMESTAMPTZ,
  saved_at          TIMESTAMPTZ,
  applied_at        TIMESTAMPTZ,
  dismissed_at      TIMESTAMPTZ,

  profile_snapshot  JSONB,
  weights_snapshot  JSONB,

  CONSTRAINT unique_ins_match_session UNIQUE (user_id, policy_id, session_id)
);

CREATE INDEX IF NOT EXISTS idx_uim_user    ON user_insurance_matches(user_id);
CREATE INDEX IF NOT EXISTS idx_uim_policy  ON user_insurance_matches(policy_id);
CREATE INDEX IF NOT EXISTS idx_uim_status  ON user_insurance_matches(status);
CREATE INDEX IF NOT EXISTS idx_uim_shown   ON user_insurance_matches(shown_at DESC);

-- =============================================================
-- TABLE: user_weight_profiles
-- Per-user learned scoring weights (updated after each session)
-- =============================================================
CREATE TABLE IF NOT EXISTS user_weight_profiles (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE UNIQUE,

  -- 8 scoring weights (must sum to 1, each >= 0.01)
  w_goal_relevance      NUMERIC(6,4) DEFAULT 0.25,
  w_financial_benefit   NUMERIC(6,4) DEFAULT 0.20,
  w_urgency_match       NUMERIC(6,4) DEFAULT 0.15,
  w_eligibility_margin  NUMERIC(6,4) DEFAULT 0.12,
  w_ease_of_access      NUMERIC(6,4) DEFAULT 0.08,
  w_coverage_priority   NUMERIC(6,4) DEFAULT 0.08,
  w_category_affinity   NUMERIC(6,4) DEFAULT 0.07,
  w_recency_deadline    NUMERIC(6,4) DEFAULT 0.05,

  -- Per-category affinity scores [0,1]
  category_affinity     JSONB DEFAULT '{}',  -- {"agriculture":0.5,"health":0.5,...}

  -- Learning state
  interaction_count     INTEGER DEFAULT 0,
  last_retrained_at     TIMESTAMPTZ,
  version               INTEGER DEFAULT 1,
  weight_history        JSONB DEFAULT '[]',  -- last N weight snapshots for debugging

  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_uwp_user ON user_weight_profiles(user_id);

-- =============================================================
-- TABLE: global_weight_profile
-- Population-level prior weights, updated nightly
-- =============================================================
CREATE TABLE IF NOT EXISTS global_weight_profile (
  id                    SERIAL PRIMARY KEY,
  version               INTEGER NOT NULL,
  is_active             BOOLEAN DEFAULT FALSE,

  w_goal_relevance      NUMERIC(6,4) DEFAULT 0.25,
  w_financial_benefit   NUMERIC(6,4) DEFAULT 0.20,
  w_urgency_match       NUMERIC(6,4) DEFAULT 0.15,
  w_eligibility_margin  NUMERIC(6,4) DEFAULT 0.12,
  w_ease_of_access      NUMERIC(6,4) DEFAULT 0.08,
  w_coverage_priority   NUMERIC(6,4) DEFAULT 0.08,
  w_category_affinity   NUMERIC(6,4) DEFAULT 0.07,
  w_recency_deadline    NUMERIC(6,4) DEFAULT 0.05,

  -- Evaluation metrics on held-out set
  ndcg_at_10            NUMERIC(5,4),
  hit_rate_at_5         NUMERIC(5,4),
  training_samples      INTEGER,
  promoted_at           TIMESTAMPTZ,
  notes                 TEXT,

  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Insert initial global weights
INSERT INTO global_weight_profile (version, is_active,
  w_goal_relevance, w_financial_benefit, w_urgency_match,
  w_eligibility_margin, w_ease_of_access, w_coverage_priority,
  w_category_affinity, w_recency_deadline,
  notes, created_at)
VALUES (1, TRUE, 0.25, 0.20, 0.15, 0.12, 0.08, 0.08, 0.07, 0.05,
  'Initial default weights (Phase 1)', NOW())
ON CONFLICT DO NOTHING;

-- =============================================================
-- TABLE: interaction_events (append-only event log)
-- =============================================================
CREATE TABLE IF NOT EXISTS interaction_events (
  id              BIGSERIAL PRIMARY KEY,
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id      UUID,

  event_type      match_action_t NOT NULL,
  entity_type     VARCHAR(20) NOT NULL,   -- 'scheme' | 'insurance'
  entity_id       UUID NOT NULL,

  -- Context at event time
  rank_position   SMALLINT,
  score_at_time   NUMERIC(7,5),
  score_breakdown JSONB,

  -- Engagement signal
  dwell_time_ms   INTEGER,               -- time spent viewing before action
  device_type     created_via_t,

  -- For deduplication on retry
  client_event_id UUID UNIQUE,           -- client-generated idempotency key

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ie_user       ON interaction_events(user_id);
CREATE INDEX IF NOT EXISTS idx_ie_entity     ON interaction_events(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_ie_event      ON interaction_events(event_type);
CREATE INDEX IF NOT EXISTS idx_ie_session    ON interaction_events(session_id);
CREATE INDEX IF NOT EXISTS idx_ie_created    ON interaction_events(created_at DESC);

-- =============================================================
-- TABLE: documents
-- =============================================================
CREATE TABLE IF NOT EXISTS documents (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  original_filename     VARCHAR(500),
  file_path             TEXT,
  mime_type             VARCHAR(100),
  file_size_bytes       INTEGER,

  -- OCR
  raw_ocr_text          TEXT,
  ocr_confidence        NUMERIC(5,2),
  ocr_language          language_t,
  detected_script       VARCHAR(50),

  -- Analysis
  summary_text          TEXT,
  summary_language      language_t,
  risk_flags            JSONB DEFAULT '[]',  -- [{type,severity,clause,explanation}]
  overall_risk          risk_severity_t,
  llm_model_used        VARCHAR(100),

  -- Q&A context
  conversation_history  JSONB DEFAULT '[]',

  processed_at          TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_docs_user    ON documents(user_id);
CREATE INDEX IF NOT EXISTS idx_docs_risk    ON documents(overall_risk);
CREATE INDEX IF NOT EXISTS idx_docs_created ON documents(created_at DESC);

-- =============================================================
-- TABLE: scraping_log
-- =============================================================
CREATE TABLE IF NOT EXISTS scraping_log (
  id              BIGSERIAL PRIMARY KEY,
  run_id          UUID DEFAULT gen_random_uuid(),
  source          VARCHAR(200) NOT NULL,
  run_type        VARCHAR(20) DEFAULT 'manual',    -- 'full'|'incremental'|'manual'

  started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at     TIMESTAMPTZ,
  duration_secs   NUMERIC(8,2),

  pages_fetched   INTEGER DEFAULT 0,
  rows_inserted   INTEGER DEFAULT 0,
  rows_updated    INTEGER DEFAULT 0,
  rows_unchanged  INTEGER DEFAULT 0,
  rows_failed     INTEGER DEFAULT 0,

  success         BOOLEAN,
  error_samples   JSONB DEFAULT '[]',
  notes           TEXT
);

CREATE INDEX IF NOT EXISTS idx_scraping_started  ON scraping_log(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_scraping_source   ON scraping_log(source);
CREATE INDEX IF NOT EXISTS idx_scraping_success  ON scraping_log(success);

-- =============================================================
-- TABLE: translations_cache
-- Cache for dynamically translated scheme text
-- =============================================================
CREATE TABLE IF NOT EXISTS translations_cache (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_hash     CHAR(64) NOT NULL,   -- SHA-256 of source text
  source_lang     language_t NOT NULL,
  target_lang     language_t NOT NULL,
  translated_text TEXT NOT NULL,
  model_used      VARCHAR(100),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT translations_unique UNIQUE (source_hash, target_lang)
);

CREATE INDEX IF NOT EXISTS idx_trans_hash ON translations_cache(source_hash, target_lang);

-- =============================================================
-- FUNCTION: auto-update updated_at
-- =============================================================
CREATE OR REPLACE FUNCTION fn_update_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

-- Apply trigger to all tables with updated_at
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'users','financial_profiles','schemes','insurance_policies',
    'user_weight_profiles','documents'
  ] LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS trg_%1$s_updated ON %1$s;
       CREATE TRIGGER trg_%1$s_updated
         BEFORE UPDATE ON %1$s
         FOR EACH ROW EXECUTE FUNCTION fn_update_updated_at();',
      t
    );
  END LOOP;
END;
$$;

-- =============================================================
-- FUNCTION: calculate profile_completeness (0-100)
-- Called from application layer after profile update
-- =============================================================
CREATE OR REPLACE FUNCTION fn_profile_completeness(fp financial_profiles)
RETURNS SMALLINT LANGUAGE plpgsql AS $$
DECLARE
  score INT := 0;
  total INT := 0;
BEGIN
  -- Core fields (each worth 10 points)
  IF fp.age IS NOT NULL THEN score := score + 10; END IF;
  IF fp.gender IS NOT NULL THEN score := score + 5; END IF;
  IF fp.caste_category IS NOT NULL THEN score := score + 10; END IF;
  IF fp.occupation IS NOT NULL THEN score := score + 10; END IF;
  IF fp.monthly_income IS NOT NULL THEN score := score + 10; END IF;
  IF fp.annual_income IS NOT NULL THEN score := score + 5; END IF;
  IF fp.ration_card_type IS NOT NULL THEN score := score + 10; END IF;
  IF fp.has_bank_account IS NOT NULL THEN score := score + 5; END IF;
  IF fp.financial_goal IS NOT NULL THEN score := score + 10; END IF;
  IF fp.urgency_level IS NOT NULL THEN score := score + 5; END IF;
  IF fp.education_level IS NOT NULL THEN score := score + 5; END IF;
  IF fp.marital_status IS NOT NULL THEN score := score + 5; END IF;
  IF fp.has_disability IS NOT NULL THEN score := score + 5; END IF;
  IF fp.num_dependents IS NOT NULL THEN score := score + 5; END IF;
  RETURN LEAST(score, 100);
END;
$$;

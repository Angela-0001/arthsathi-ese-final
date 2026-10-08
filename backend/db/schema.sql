-- =============================================================
-- ArthSathi PostgreSQL Schema
-- Version: 1.0
-- Description: Complete database schema for the ArthSathi
--   AI-powered multilingual financial companion.
-- =============================================================

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =============================================================
-- ENUM TYPES
-- =============================================================

-- Interaction modes: user can type+read OR speak+listen
CREATE TYPE interaction_mode AS ENUM ('text', 'voice');

-- Gender options (inclusive)
CREATE TYPE gender_type AS ENUM ('male', 'female', 'transgender', 'other', 'prefer_not_to_say');

-- Caste categories used in Indian government schemes
CREATE TYPE caste_category AS ENUM ('general', 'obc', 'sc', 'st', 'nt', 'vjnt', 'other');

-- Occupation categories relevant to rural India
CREATE TYPE occupation_type AS ENUM (
  'farmer', 'farm_laborer', 'artisan', 'self_employed',
  'daily_wage', 'domestic_worker', 'fisherman', 'weaver',
  'construction_worker', 'street_vendor', 'unemployed', 'other'
);

-- Scheme/policy category
CREATE TYPE scheme_category AS ENUM (
  'agriculture', 'health', 'education', 'housing',
  'social_security', 'employment', 'women_welfare',
  'minority_welfare', 'disability', 'insurance', 'other'
);

-- Match status in user_scheme_matches
CREATE TYPE match_status AS ENUM ('shown', 'clicked', 'applied', 'dismissed');

-- Supported languages at launch
CREATE TYPE language_code AS ENUM ('hi', 'mr', 'ta', 'te', 'bn', 'en');

-- Document risk level
CREATE TYPE risk_level AS ENUM ('low', 'medium', 'high');

-- =============================================================
-- TABLE: users
-- Core user identity and preferences.
-- =============================================================
CREATE TABLE IF NOT EXISTS users (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Identity
  full_name           VARCHAR(200),
  phone_number        VARCHAR(15) UNIQUE,           -- E.164 format, e.g. +919876543210
  aadhaar_hash        CHAR(64),                     -- SHA-256 of Aadhaar number, never plain text
  verified            BOOLEAN NOT NULL DEFAULT FALSE,

  -- Location
  state               VARCHAR(100),
  district            VARCHAR(100),
  village             VARCHAR(200),
  pincode             CHAR(6),

  -- Preferences
  preferred_language  language_code NOT NULL DEFAULT 'hi',
  interaction_mode    interaction_mode NOT NULL DEFAULT 'voice',

  -- Metadata
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Constraints
  CONSTRAINT phone_format CHECK (phone_number ~ '^\+[1-9]\d{9,14}$')
);

CREATE INDEX idx_users_phone    ON users(phone_number);
CREATE INDEX idx_users_state    ON users(state);
CREATE INDEX idx_users_language ON users(preferred_language);

-- =============================================================
-- TABLE: financial_profiles
-- One row per user; captures everything the recommendation
-- engine needs to filter and score schemes.
-- =============================================================
CREATE TABLE IF NOT EXISTS financial_profiles (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Demographics
  age                   SMALLINT CHECK (age > 0 AND age < 130),
  gender                gender_type,
  caste_category        caste_category,
  occupation            occupation_type,
  is_disabled           BOOLEAN DEFAULT FALSE,
  disability_percent    SMALLINT CHECK (disability_percent BETWEEN 0 AND 100),

  -- Economic data (all amounts in INR)
  monthly_income        NUMERIC(12, 2) CHECK (monthly_income >= 0),
  annual_income         NUMERIC(12, 2) CHECK (annual_income >= 0),
  total_debts           NUMERIC(12, 2) DEFAULT 0,
  land_holding_acres    NUMERIC(6, 2) DEFAULT 0,   -- relevant for farm schemes
  num_dependents        SMALLINT DEFAULT 0,
  has_bank_account      BOOLEAN DEFAULT FALSE,
  has_jan_dhan_account  BOOLEAN DEFAULT FALSE,
  ration_card_type      VARCHAR(20),                -- APL / BPL / AAY

  -- Goal
  financial_goal        VARCHAR(500),               -- free text, e.g. "buy seeds for kharif"
  goal_amount           NUMERIC(12, 2),
  goal_timeframe_months SMALLINT,
  urgency_level         SMALLINT CHECK (urgency_level BETWEEN 1 AND 5),  -- 1=low, 5=critical

  -- Metadata
  completed_at          TIMESTAMPTZ,               -- NULL = onboarding in progress
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT one_profile_per_user UNIQUE (user_id)
);

CREATE INDEX idx_fp_user        ON financial_profiles(user_id);
CREATE INDEX idx_fp_state       ON financial_profiles(user_id);  -- join via users
CREATE INDEX idx_fp_income      ON financial_profiles(annual_income);
CREATE INDEX idx_fp_caste       ON financial_profiles(caste_category);
CREATE INDEX idx_fp_occupation  ON financial_profiles(occupation);

-- =============================================================
-- TABLE: schemes
-- Government welfare and financial schemes.
-- Populated and kept fresh by the background scraper.
-- =============================================================
CREATE TABLE IF NOT EXISTS schemes (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stable_id           VARCHAR(200) UNIQUE NOT NULL,  -- scraper key, e.g. "myscheme-PM-KISAN-001"

  -- Identification
  name_en             VARCHAR(500) NOT NULL,
  name_hi             VARCHAR(500),
  name_mr             VARCHAR(500),
  name_ta             VARCHAR(500),
  name_te             VARCHAR(500),
  name_bn             VARCHAR(500),

  -- Description
  description_en      TEXT,
  description_hi      TEXT,

  -- Eligibility criteria (structured — used by the recommendation engine)
  min_age             SMALLINT,
  max_age             SMALLINT,
  min_annual_income   NUMERIC(12, 2),
  max_annual_income   NUMERIC(12, 2),
  eligible_states     TEXT[],                  -- NULL = all India
  eligible_genders    gender_type[],           -- NULL = all genders
  eligible_castes     caste_category[],        -- NULL = all categories
  eligible_occupations occupation_type[],      -- NULL = all occupations
  requires_bank_account BOOLEAN DEFAULT FALSE,
  requires_land       BOOLEAN DEFAULT FALSE,

  -- Benefit
  category            scheme_category NOT NULL DEFAULT 'other',
  benefit_amount      NUMERIC(12, 2),          -- INR; NULL if non-monetary
  benefit_description TEXT,
  tags                TEXT[],                  -- e.g. ["farmer","seed","kharif"]

  -- Source
  source_url          TEXT,
  ministry            VARCHAR(300),
  application_url     TEXT,

  -- Freshness
  last_scraped_at     TIMESTAMPTZ,
  is_active           BOOLEAN NOT NULL DEFAULT TRUE,

  -- Metadata
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_schemes_stable_id   ON schemes(stable_id);
CREATE INDEX idx_schemes_category    ON schemes(category);
CREATE INDEX idx_schemes_active      ON schemes(is_active);
CREATE INDEX idx_schemes_income      ON schemes(min_annual_income, max_annual_income);
CREATE INDEX idx_schemes_age         ON schemes(min_age, max_age);
CREATE INDEX idx_schemes_tags        ON schemes USING gin(tags);
CREATE INDEX idx_schemes_states      ON schemes USING gin(eligible_states);

-- =============================================================
-- TABLE: insurance_policies
-- Government-backed insurance schemes (PMJJBY, PMSBY, etc.)
-- =============================================================
CREATE TABLE IF NOT EXISTS insurance_policies (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stable_id             VARCHAR(200) UNIQUE NOT NULL,

  -- Identification
  name_en               VARCHAR(500) NOT NULL,
  name_hi               VARCHAR(500),
  name_mr               VARCHAR(500),
  name_ta               VARCHAR(500),
  name_te               VARCHAR(500),
  name_bn               VARCHAR(500),

  -- Description
  description_en        TEXT,
  description_hi        TEXT,

  -- Eligibility
  min_age               SMALLINT,
  max_age               SMALLINT,
  min_annual_income     NUMERIC(12, 2),
  max_annual_income     NUMERIC(12, 2),
  eligible_states       TEXT[],
  eligible_genders      gender_type[],
  eligible_castes       caste_category[],
  requires_bank_account BOOLEAN DEFAULT TRUE,
  requires_jan_dhan     BOOLEAN DEFAULT FALSE,

  -- Insurance details
  category              scheme_category NOT NULL DEFAULT 'insurance',
  annual_premium        NUMERIC(10, 2),          -- INR per year
  coverage_amount       NUMERIC(12, 2),          -- INR sum assured
  coverage_type         VARCHAR(200),            -- e.g. "life", "accident", "health"
  claim_process         TEXT,
  tags                  TEXT[],

  -- Source
  source_url            TEXT,
  administered_by       VARCHAR(300),            -- e.g. "LIC", "New India Assurance"
  application_url       TEXT,

  -- Freshness
  last_scraped_at       TIMESTAMPTZ,
  is_active             BOOLEAN NOT NULL DEFAULT TRUE,

  -- Metadata
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_insurance_stable_id ON insurance_policies(stable_id);
CREATE INDEX idx_insurance_category  ON insurance_policies(category);
CREATE INDEX idx_insurance_active    ON insurance_policies(is_active);
CREATE INDEX idx_insurance_premium   ON insurance_policies(annual_premium);
CREATE INDEX idx_insurance_tags      ON insurance_policies USING gin(tags);

-- =============================================================
-- TABLE: user_scheme_matches
-- Tracks every scheme shown to, clicked, or applied for by
-- each user. Powers the adaptive learning loop.
-- =============================================================
CREATE TABLE IF NOT EXISTS user_scheme_matches (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scheme_id     UUID NOT NULL REFERENCES schemes(id) ON DELETE CASCADE,

  score         NUMERIC(6, 4) NOT NULL,      -- 0.0–1.0 composite score
  rank_position SMALLINT,                    -- position in result list when shown
  status        match_status NOT NULL DEFAULT 'shown',

  shown_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  clicked_at    TIMESTAMPTZ,
  applied_at    TIMESTAMPTZ,
  dismissed_at  TIMESTAMPTZ,

  -- Snapshot of user's profile at match time (for model retraining)
  profile_snapshot JSONB,

  CONSTRAINT unique_user_scheme UNIQUE (user_id, scheme_id, shown_at)
);

CREATE INDEX idx_usm_user     ON user_scheme_matches(user_id);
CREATE INDEX idx_usm_scheme   ON user_scheme_matches(scheme_id);
CREATE INDEX idx_usm_status   ON user_scheme_matches(status);
CREATE INDEX idx_usm_shown    ON user_scheme_matches(shown_at);

-- =============================================================
-- TABLE: user_insurance_matches
-- Same pattern as user_scheme_matches, for insurance policies.
-- =============================================================
CREATE TABLE IF NOT EXISTS user_insurance_matches (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  policy_id       UUID NOT NULL REFERENCES insurance_policies(id) ON DELETE CASCADE,

  score           NUMERIC(6, 4) NOT NULL,
  rank_position   SMALLINT,
  status          match_status NOT NULL DEFAULT 'shown',

  shown_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  clicked_at      TIMESTAMPTZ,
  applied_at      TIMESTAMPTZ,
  dismissed_at    TIMESTAMPTZ,

  profile_snapshot JSONB,

  CONSTRAINT unique_user_insurance UNIQUE (user_id, policy_id, shown_at)
);

CREATE INDEX idx_uim_user     ON user_insurance_matches(user_id);
CREATE INDEX idx_uim_policy   ON user_insurance_matches(policy_id);
CREATE INDEX idx_uim_status   ON user_insurance_matches(status);

-- =============================================================
-- TABLE: documents
-- User-uploaded or camera-captured documents processed through
-- OCR + LLM summarization pipeline.
-- =============================================================
CREATE TABLE IF NOT EXISTS documents (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Original file
  original_filename  VARCHAR(500),
  file_path          TEXT,                   -- local storage path on server
  mime_type          VARCHAR(100),

  -- OCR output
  raw_ocr_text       TEXT,                  -- raw Tesseract output
  ocr_confidence     NUMERIC(5, 2),         -- 0–100 average confidence score
  ocr_language       language_code,

  -- LLM analysis
  summary_text       TEXT,                  -- plain-language summary
  summary_language   language_code,
  risk_flags         JSONB,                 -- array of {clause, risk_type, explanation}
  risk_level         risk_level,
  llm_model_used     VARCHAR(100),          -- e.g. "mistral:7b"

  -- Conversation context
  conversation_history JSONB,              -- [{role, content}] for follow-up Q&A

  -- Metadata
  processed_at       TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_docs_user      ON documents(user_id);
CREATE INDEX idx_docs_risk      ON documents(risk_level);
CREATE INDEX idx_docs_created   ON documents(created_at);

-- =============================================================
-- TABLE: scraping_log
-- Audit trail for every scraper run.
-- =============================================================
CREATE TABLE IF NOT EXISTS scraping_log (
  id              SERIAL PRIMARY KEY,
  run_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source          VARCHAR(200) NOT NULL,    -- e.g. "myscheme.gov.in", "irdai.gov.in"
  run_type        VARCHAR(50) DEFAULT 'scheduled',  -- 'scheduled' | 'manual'
  rows_added      INTEGER DEFAULT 0,
  rows_updated    INTEGER DEFAULT 0,
  rows_failed     INTEGER DEFAULT 0,
  success         BOOLEAN NOT NULL,
  error_message   TEXT,                    -- NULL on success
  duration_secs   NUMERIC(8, 2),
  details         JSONB                    -- per-source breakdown if needed
);

CREATE INDEX idx_scraping_log_run_at  ON scraping_log(run_at DESC);
CREATE INDEX idx_scraping_log_source  ON scraping_log(source);
CREATE INDEX idx_scraping_log_success ON scraping_log(success);

-- =============================================================
-- TABLE: interaction_events
-- Granular event log for the adaptive learning engine.
-- Every click, scroll-past, and application is recorded here
-- to feed periodic weight recalibration.
-- =============================================================
CREATE TABLE IF NOT EXISTS interaction_events (
  id            BIGSERIAL PRIMARY KEY,
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_type    VARCHAR(50) NOT NULL,   -- 'view','click','apply','dismiss','call_ivr'
  entity_type   VARCHAR(20) NOT NULL,  -- 'scheme' | 'insurance'
  entity_id     UUID NOT NULL,
  score_at_time NUMERIC(6, 4),
  rank_at_time  SMALLINT,
  session_id    UUID,
  device_type   VARCHAR(20),           -- 'web' | 'ivr' | 'pwa'
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ie_user        ON interaction_events(user_id);
CREATE INDEX idx_ie_entity      ON interaction_events(entity_type, entity_id);
CREATE INDEX idx_ie_event_type  ON interaction_events(event_type);
CREATE INDEX idx_ie_created     ON interaction_events(created_at DESC);

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

CREATE TRIGGER trg_users_updated
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_fp_updated
  BEFORE UPDATE ON financial_profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_schemes_updated
  BEFORE UPDATE ON schemes
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_insurance_updated
  BEFORE UPDATE ON insurance_policies
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_documents_updated
  BEFORE UPDATE ON documents
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- =============================================================
-- SEED: Initial insurance policies (PMJJBY, PMSBY, Ayushman Bharat)
-- =============================================================
INSERT INTO insurance_policies (
  stable_id, name_en, name_hi,
  description_en, min_age, max_age,
  max_annual_income, requires_bank_account,
  annual_premium, coverage_amount, coverage_type,
  category, tags, source_url, administered_by, last_scraped_at
) VALUES
(
  'GOI-PMJJBY-001',
  'Pradhan Mantri Jeevan Jyoti Bima Yojana (PMJJBY)',
  'प्रधान मंत्री जीवन ज्योति बीमा योजना',
  'Life insurance cover of ₹2 lakh for death due to any reason. Annual premium ₹436 auto-debited from bank account.',
  18, 50, NULL, TRUE,
  436.00, 200000.00, 'life',
  'insurance',
  ARRAY['life_insurance','death_cover','bank_account'],
  'https://jansuraksha.gov.in/PMJJBY.aspx',
  'LIC and other life insurers via banks',
  NOW()
),
(
  'GOI-PMSBY-001',
  'Pradhan Mantri Suraksha Bima Yojana (PMSBY)',
  'प्रधान मंत्री सुरक्षा बीमा योजना',
  'Accident insurance: ₹2 lakh for accidental death or total disability, ₹1 lakh for partial disability. Premium just ₹20/year.',
  18, 70, NULL, TRUE,
  20.00, 200000.00, 'accident',
  'insurance',
  ARRAY['accident_insurance','disability','bank_account','low_premium'],
  'https://jansuraksha.gov.in/PMSBY.aspx',
  'Non-life insurance companies via banks',
  NOW()
),
(
  'GOI-PMFBY-001',
  'Pradhan Mantri Fasal Bima Yojana (PMFBY)',
  'प्रधान मंत्री फसल बीमा योजना',
  'Crop insurance for farmers against natural calamities, pests & diseases. Farmer pays only 1.5–5% premium.',
  18, NULL, NULL, TRUE,
  NULL, NULL, 'crop',
  'insurance',
  ARRAY['crop_insurance','farmer','natural_disaster','kharif','rabi'],
  'https://pmfby.gov.in',
  'Agriculture Insurance Company of India',
  NOW()
),
(
  'GOI-ABPMJAY-001',
  'Ayushman Bharat Pradhan Mantri Jan Arogya Yojana (AB-PMJAY)',
  'आयुष्मान भारत प्रधान मंत्री जन आरोग्य योजना',
  'Health cover of ₹5 lakh per family per year for secondary and tertiary hospitalisation. Targets bottom 40% of population.',
  NULL, NULL, NULL, FALSE,
  0.00, 500000.00, 'health',
  'health',
  ARRAY['health_insurance','hospitalisation','free','ration_card','bpl'],
  'https://pmjay.gov.in',
  'National Health Authority',
  NOW()
);

-- =============================================================
-- SEED: Initial government schemes
-- =============================================================
INSERT INTO schemes (
  stable_id, name_en, name_hi,
  description_en, min_age, max_age,
  max_annual_income, eligible_occupations,
  category, benefit_amount, benefit_description,
  tags, source_url, ministry, last_scraped_at
) VALUES
(
  'GOI-PMKISAN-001',
  'PM-KISAN (Pradhan Mantri Kisan Samman Nidhi)',
  'पीएम किसान सम्मान निधि',
  'Direct income support of ₹6,000 per year to all landholding farmer families, paid in 3 instalments of ₹2,000.',
  18, NULL, NULL,
  ARRAY['farmer']::occupation_type[],
  'agriculture', 6000.00,
  '₹6,000/year in 3 equal instalments directly to bank account',
  ARRAY['farmer','income_support','direct_benefit','bank_account'],
  'https://pmkisan.gov.in', 'Ministry of Agriculture & Farmers Welfare',
  NOW()
),
(
  'GOI-MGNREGS-001',
  'MGNREGS (Mahatma Gandhi National Rural Employment Guarantee Scheme)',
  'महात्मा गांधी राष्ट्रीय ग्रामीण रोजगार गारंटी योजना',
  'Guarantees 100 days of wage employment per year to rural households. Wage paid directly to bank/post office account.',
  18, NULL, NULL,
  ARRAY['farm_laborer','daily_wage','unemployed','farmer']::occupation_type[],
  'employment', NULL,
  '100 days guaranteed wage employment per year',
  ARRAY['employment','rural','wage','100_days'],
  'https://nrega.nic.in', 'Ministry of Rural Development',
  NOW()
),
(
  'GOI-PMAY-G-001',
  'Pradhan Mantri Awaas Yojana – Gramin (PMAY-G)',
  'प्रधान मंत्री आवास योजना (ग्रामीण)',
  'Financial assistance of ₹1.20 lakh in plains and ₹1.30 lakh in hilly states for construction of pucca house.',
  18, NULL, 200000.00, NULL,
  'housing', 120000.00,
  '₹1.20–1.30 lakh for pucca house construction',
  ARRAY['housing','pucca_house','bpl','rural'],
  'https://pmayg.nic.in', 'Ministry of Rural Development',
  NOW()
),
(
  'GOI-NSP-POST-MATRIC-001',
  'Post-Matric Scholarship for SC Students',
  'अनुसूचित जाति के छात्रों के लिए पोस्ट-मैट्रिक छात्रवृत्ति',
  'Scholarship for SC students pursuing post-matriculation education. Covers tuition, maintenance, and other charges.',
  NULL, 30,
  250000.00, NULL,
  'education', NULL,
  'Full tuition fee + maintenance allowance',
  ARRAY['scholarship','sc','education','post_matric'],
  'https://scholarships.gov.in', 'Ministry of Social Justice & Empowerment',
  NOW()
);

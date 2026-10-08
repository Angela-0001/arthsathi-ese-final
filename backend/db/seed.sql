-- =============================================================
-- ArthSathi Seed Data — Initial schemes and insurance policies
-- =============================================================

-- Insurance Policies
INSERT INTO insurance_policies (
  stable_id, name_en,
  description_en, min_age, max_age,
  requires_bank_account,
  annual_premium, coverage_amount, coverage_type,
  category, tags, source_url, administered_by, last_scraped_at
) VALUES
(
  'GOI-PMJJBY-001',
  'Pradhan Mantri Jeevan Jyoti Bima Yojana (PMJJBY)',
  'Life insurance cover of Rs.2 lakh for death due to any reason. Annual premium Rs.436 auto-debited from bank account.',
  18, 50, TRUE,
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
  'Accident insurance: Rs.2 lakh for accidental death or total disability, Rs.1 lakh for partial disability. Premium Rs.20/year.',
  18, 70, TRUE,
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
  'Crop insurance for farmers against natural calamities, pests and diseases. Farmer pays only 1.5-5% premium.',
  18, NULL, TRUE,
  NULL, NULL, 'crop',
  'agriculture',
  ARRAY['crop_insurance','farmer','natural_disaster','kharif','rabi'],
  'https://pmfby.gov.in',
  'Agriculture Insurance Company of India',
  NOW()
),
(
  'GOI-ABPMJAY-001',
  'Ayushman Bharat Pradhan Mantri Jan Arogya Yojana (AB-PMJAY)',
  'Health cover of Rs.5 lakh per family per year for secondary and tertiary hospitalisation. Targets bottom 40% of population.',
  NULL, NULL, FALSE,
  0.00, 500000.00, 'health',
  'health',
  ARRAY['health_insurance','hospitalisation','free','ration_card','bpl'],
  'https://pmjay.gov.in',
  'National Health Authority',
  NOW()
)
ON CONFLICT (stable_id) DO UPDATE SET
  description_en   = EXCLUDED.description_en,
  annual_premium   = EXCLUDED.annual_premium,
  coverage_amount  = EXCLUDED.coverage_amount,
  last_scraped_at  = EXCLUDED.last_scraped_at,
  updated_at       = NOW();

-- Government Schemes
INSERT INTO schemes (
  stable_id, name_en,
  description_en, min_age, max_age,
  max_annual_income, eligible_occupations,
  category, benefit_amount, benefit_description,
  tags, source_url, ministry, last_scraped_at
) VALUES
(
  'GOI-PMKISAN-001',
  'PM-KISAN (Pradhan Mantri Kisan Samman Nidhi)',
  'Direct income support of Rs.6,000 per year to all landholding farmer families, paid in 3 instalments of Rs.2,000.',
  18, NULL, NULL,
  ARRAY['farmer']::occupation_type[],
  'agriculture', 6000.00,
  'Rs.6,000/year in 3 equal instalments directly to bank account',
  ARRAY['farmer','income_support','direct_benefit','bank_account'],
  'https://pmkisan.gov.in', 'Ministry of Agriculture and Farmers Welfare',
  NOW()
),
(
  'GOI-MGNREGS-001',
  'MGNREGS (Mahatma Gandhi National Rural Employment Guarantee Scheme)',
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
  'Pradhan Mantri Awaas Yojana - Gramin (PMAY-G)',
  'Financial assistance of Rs.1.20 lakh in plains and Rs.1.30 lakh in hilly states for construction of pucca house.',
  18, NULL, 200000.00, NULL,
  'housing', 120000.00,
  'Rs.1.20-1.30 lakh for pucca house construction',
  ARRAY['housing','pucca_house','bpl','rural'],
  'https://pmayg.nic.in', 'Ministry of Rural Development',
  NOW()
),
(
  'GOI-NSP-POST-MATRIC-SC-001',
  'Post-Matric Scholarship for SC Students',
  'Scholarship for SC students pursuing post-matriculation education. Covers tuition, maintenance, and other charges.',
  NULL, 30,
  250000.00, NULL,
  'education', NULL,
  'Full tuition fee + maintenance allowance',
  ARRAY['scholarship','sc','education','post_matric'],
  'https://scholarships.gov.in', 'Ministry of Social Justice and Empowerment',
  NOW()
),
(
  'GOI-NSFDC-001',
  'National SC Finance and Development Corporation (NSFDC) Loans',
  'Concessional loans up to Rs.15 lakh for SC persons below double the poverty line for income-generating activities.',
  18, 55,
  NULL,
  ARRAY['self_employed','artisan','farmer']::occupation_type[],
  'social_security', NULL,
  'Concessional loan up to Rs.15 lakh at 5-8% interest',
  ARRAY['loan','sc','self_employment','below_poverty_line'],
  'https://nsfdc.nic.in', 'Ministry of Social Justice and Empowerment',
  NOW()
),
(
  'GOI-PMMY-SHISHU-001',
  'MUDRA Loan - Shishu Category (Pradhan Mantri MUDRA Yojana)',
  'Collateral-free micro-loans up to Rs.50,000 for non-farm small/micro enterprises and self-employed individuals.',
  18, NULL,
  NULL,
  ARRAY['self_employed','artisan','street_vendor','weaver']::occupation_type[],
  'employment', NULL,
  'Loan up to Rs.50,000 without collateral',
  ARRAY['loan','micro_enterprise','self_employment','mudra','collateral_free'],
  'https://www.mudra.org.in', 'Ministry of Finance',
  NOW()
)
ON CONFLICT (stable_id) DO UPDATE SET
  description_en       = EXCLUDED.description_en,
  benefit_amount       = EXCLUDED.benefit_amount,
  benefit_description  = EXCLUDED.benefit_description,
  max_annual_income    = EXCLUDED.max_annual_income,
  last_scraped_at      = EXCLUDED.last_scraped_at,
  updated_at           = NOW();

-- ArthSathi Migration 002 — Seed Core Government Insurance Policies
-- These are the major central government insurance schemes available to all Indians

INSERT INTO insurance_policies (
  source_id, source_url, content_hash,
  name, description, eligibility_text,
  level, applicable_states, ministry, administered_by,
  category, tags, benefit_type,
  annual_premium, coverage_amount, coverage_type,
  min_age, max_age,
  requires_bank_account, requires_aadhaar, requires_jan_dhan, requires_bpl,
  application_url, documents_required,
  first_scraped_at, last_scraped_at, is_active
) VALUES

-- PMJJBY
(
  'pmjjby',
  'https://jansuraksha.gov.in/PMJJBY.aspx',
  'pmjjby-static-v1',
  '{"en":"Pradhan Mantri Jeevan Jyoti Bima Yojana (PMJJBY)","hi":"प्रधान मंत्री जीवन ज्योति बीमा योजना","mr":"प्रधान मंत्री जीवन ज्योति विमा योजना","ta":"பிரதான் மந்திரி ஜீவன் ஜ்யோதி காப்பீட்டு திட்டம்","te":"ప్రధాన మంత్రి జీవన్ జ్యోతి బీమా యోజన","bn":"প্রধানমন্ত্রী জীবন জ্যোতি বীমা যোজনা"}',
  '{"en":"Life insurance cover of Rs.2 lakh for death due to any reason. Annual premium Rs.436 auto-debited from bank account. Renewable every year."}',
  '{"en":"Age 18-50 years. Must have a savings bank account or Jan Dhan account. Aadhaar should be linked to bank account. Auto-debit consent required."}',
  'central', NULL,
  'Ministry of Finance',
  'LIC and other life insurance companies via partner banks',
  'insurance',
  ARRAY['life_insurance','death_cover','bank_account','jandhan','central_scheme'],
  'insurance',
  436.00, 200000.00, 'life insurance',
  18, 50,
  TRUE, FALSE, FALSE, FALSE,
  'https://jansuraksha.gov.in/Forms-PMJJBY.aspx',
  '["Bank account details","Aadhaar card","Nominee declaration form"]',
  NOW(), NOW(), TRUE
),

-- PMSBY
(
  'pmsby',
  'https://jansuraksha.gov.in/PMSBY.aspx',
  'pmsby-static-v1',
  '{"en":"Pradhan Mantri Suraksha Bima Yojana (PMSBY)","hi":"प्रधान मंत्री सुरक्षा बीमा योजना","mr":"प्रधान मंत्री सुरक्षा विमा योजना","ta":"பிரதான் மந்திரி சுரக்ஷா காப்பீட்டு திட்டம்","te":"ప్రధాన మంత్రి సురక్షా బీమా యోజన","bn":"প্রধানমন্ত্রী সুরক্ষা বীমা যোজনা"}',
  '{"en":"Accident insurance: Rs.2 lakh for accidental death or total permanent disability, Rs.1 lakh for partial permanent disability. Annual premium only Rs.20 — one of the cheapest insurance plans available."}',
  '{"en":"Age 18-70 years. Must have a savings bank account. Auto-debit consent required. Available to all Indian citizens."}',
  'central', NULL,
  'Ministry of Finance',
  'General insurance companies via partner banks',
  'insurance',
  ARRAY['accident_insurance','disability','low_premium','bank_account','central_scheme'],
  'insurance',
  20.00, 200000.00, 'accident',
  18, 70,
  TRUE, FALSE, FALSE, FALSE,
  'https://jansuraksha.gov.in/Forms-PMSBY.aspx',
  '["Bank account details","Nominee declaration form"]',
  NOW(), NOW(), TRUE
),

-- AB-PMJAY (Ayushman Bharat)
(
  'ab-pmjay',
  'https://pmjay.gov.in',
  'pmjay-static-v1',
  '{"en":"Ayushman Bharat PM-JAY (AB-PMJAY)","hi":"आयुष्मान भारत प्रधान मंत्री जन आरोग्य योजना","mr":"आयुष्मान भारत प्रधान मंत्री जन आरोग्य योजना","ta":"ஆயுஷ்மான் பாரத் பிரதான் மந்திரி ஜன் ஆரோக்ய திட்டம்","te":"ఆయుష్మాన్ భారత్ పీఎం-జేఏవై","bn":"আয়ুষ্মান ভারত প্রধানমন্ত্রী জন আরোগ্য যোজনা"}',
  '{"en":"Health cover of Rs.5 lakh per family per year for secondary and tertiary hospitalisation. Cashless treatment at empanelled hospitals across India. Targets bottom 40% of population identified by SECC 2011 data."}',
  '{"en":"Family must be identified in SECC 2011 list. Alternatively, hold AAY or PHH ration card. No age limit. Covers pre-existing diseases from day 1. Aadhaar helpful but not mandatory. No income certificate required."}',
  'central', NULL,
  'Ministry of Health and Family Welfare',
  'National Health Authority',
  'health',
  ARRAY['health_insurance','hospitalisation','cashless','bpl','ration_card','free','central_scheme'],
  'insurance',
  0.00, 500000.00, 'health',
  NULL, NULL,
  FALSE, FALSE, FALSE, TRUE,
  'https://beneficiary.nha.gov.in',
  '["Aadhaar card (helpful)","Ration card (AAY/PHH)","SECC list verification at hospital"]',
  NOW(), NOW(), TRUE
),

-- PMFBY (Fasal Bima)
(
  'pmfby',
  'https://pmfby.gov.in',
  'pmfby-static-v1',
  '{"en":"Pradhan Mantri Fasal Bima Yojana (PMFBY)","hi":"प्रधान मंत्री फसल बीमा योजना","mr":"प्रधान मंत्री पीक विमा योजना","ta":"பிரதான் மந்திரி பசல் பீமா யோஜனா","te":"పీఎం ఫసల్ బీమా యోజన","bn":"প্রধানমন্ত্রী ফসল বীমা যোজনা"}',
  '{"en":"Crop insurance against losses due to natural calamities, pests, and diseases. Farmer pays 1.5% premium for Kharif, 2% for Rabi crops — government subsidises the rest. Covers up to full sum insured per hectare."}',
  '{"en":"Must be a farmer (landowner or tenant) with crop sown. Bank account required for premium debit. Land records or lease agreement needed. Apply through bank branch or CSC before cropping season."}',
  'central', NULL,
  'Ministry of Agriculture and Farmers Welfare',
  'Agriculture Insurance Company of India and approved insurers',
  'agriculture',
  ARRAY['crop_insurance','farmer','kharif','rabi','natural_disaster','subsidised','central_scheme'],
  'insurance',
  NULL, NULL, 'crop',
  18, NULL,
  TRUE, TRUE, FALSE, FALSE,
  'https://pmfby.gov.in',
  '["Land records or lease agreement","Bank account details","Sown crop declaration","Aadhaar card"]',
  NOW(), NOW(), TRUE
),

-- APY (Atal Pension Yojana)
(
  'apy',
  'https://npscra.nsdl.co.in/scheme-details.php',
  'apy-static-v1',
  '{"en":"Atal Pension Yojana (APY)","hi":"अटल पेंशन योजना","mr":"अटल पेंशन योजना","ta":"அடல் பென்சன் யோஜனா","te":"అటల్ పెన్షన్ యోజన","bn":"অটল পেনশন যোজনা"}',
  '{"en":"Government-backed pension scheme for unorganised sector workers. Guaranteed pension of Rs.1,000-5,000/month after age 60, depending on contribution. Spouse continues to get pension after subscriber death."}',
  '{"en":"Age 18-40 years. Must have bank account. Must not be income taxpayer (from Oct 2022). Preferably workers in unorganised sector — labourers, domestic workers, daily wage earners, small traders."}',
  'central', NULL,
  'Ministry of Finance / PFRDA',
  'PFRDA via partner banks',
  'social_security',
  ARRAY['pension','retirement','unorganised_sector','bank_account','long_term','central_scheme'],
  'pension',
  NULL, NULL, 'pension',
  18, 40,
  TRUE, FALSE, FALSE, FALSE,
  'https://npscra.nsdl.co.in/scheme-details.php',
  '["Bank account details","Aadhaar card","Mobile number"]',
  NOW(), NOW(), TRUE
),

-- PMKMY (PM Kisan Maan Dhan Yojana) - Farmer Pension
(
  'pm-kmy',
  'https://pmkmy.gov.in',
  'pmkmy-static-v1',
  '{"en":"PM Kisan Maan Dhan Yojana (PM-KMY)","hi":"प्रधान मंत्री किसान मानधन योजना","mr":"प्रधान मंत्री शेतकरी मानधन योजना","ta":"பிரதான் மந்திரி கிசான் மான் தன் யோஜன","te":"పీఎం కిసాన్ మాన్ ధన్ యోజన","bn":"প্রধানমন্ত্রী কৃষক মান ধন যোজনা"}',
  '{"en":"Pension scheme for small and marginal farmers. Guaranteed pension of Rs.3,000/month after age 60. Entry age 18-40. Contribution Rs.55-200/month matched by government."}',
  '{"en":"Small and marginal farmer with cultivable land up to 2 hectares. Age 18-40 years. Must have Aadhaar and bank account (preferably Jan Dhan). Land records required."}',
  'central', NULL,
  'Ministry of Agriculture and Farmers Welfare',
  'LIC via CSC / bank branches',
  'agriculture',
  ARRAY['farmer','pension','small_farmer','marginal_farmer','retirement','central_scheme'],
  'pension',
  NULL, NULL, 'pension',
  18, 40,
  TRUE, TRUE, FALSE, FALSE,
  'https://pmkmy.gov.in',
  '["Aadhaar card","Bank account (Jan Dhan preferred)","Land records (up to 2 hectares)"]',
  NOW(), NOW(), TRUE
)

ON CONFLICT (source_id) DO UPDATE SET
  name             = EXCLUDED.name,
  description      = EXCLUDED.description,
  last_scraped_at  = EXCLUDED.last_scraped_at;

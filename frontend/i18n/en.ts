/**
 * ArthSathi — English translations
 * This is the canonical translation file. All other languages mirror these keys.
 */
const en: Record<string, string> = {
  // App
  'app.name': 'ArthSathi',
  'app.tagline': 'Your Financial Companion',
  'app.loading': 'Loading...',

  // Language selection
  'lang.select_title': 'Choose Your Language',
  'lang.select_subtitle': 'Select the language you are most comfortable with',
  'lang.hi': 'Hindi',
  'lang.mr': 'Marathi',
  'lang.ta': 'Tamil',
  'lang.te': 'Telugu',
  'lang.bn': 'Bengali',
  'lang.en': 'English',

  // Mode selection
  'mode.select_title': 'How would you like to use ArthSathi?',
  'mode.text': 'Type & Read',
  'mode.text_desc': 'Read questions and type answers',
  'mode.voice': 'Speak & Listen',
  'mode.voice_desc': 'Listen to questions and answer by voice',

  // Onboarding
  'onboarding.welcome': 'Welcome to ArthSathi',
  'onboarding.welcome_sub': 'We will help you find government schemes and insurance you qualify for — for free.',
  'onboarding.start': 'Get Started',
  'onboarding.back': 'Back',
  'onboarding.next': 'Next',
  'onboarding.skip': 'Skip',
  'onboarding.finish': 'See My Results',
  'onboarding.step': 'Step {{current}} of {{total}}',

  'onboarding.name_question': 'What is your name?',
  'onboarding.name_placeholder': 'Enter your full name',
  'onboarding.phone_question': 'What is your mobile number?',
  'onboarding.phone_placeholder': '+91 XXXXX XXXXX',
  'onboarding.state_question': 'Which state do you live in?',
  'onboarding.district_question': 'Which district?',
  'onboarding.age_question': 'How old are you?',
  'onboarding.gender_question': 'What is your gender?',
  'onboarding.caste_question': 'What is your caste category?',
  'onboarding.occupation_question': 'What do you do for work?',
  'onboarding.income_question': 'How much do you earn in a month (in Rupees)?',
  'onboarding.income_placeholder': 'e.g. 5000',
  'onboarding.debts_question': 'Do you have any loans or debts? How much total?',
  'onboarding.dependents_question': 'How many family members depend on you?',
  'onboarding.bank_question': 'Do you have a bank account?',
  'onboarding.jandhan_question': 'Do you have a Jan Dhan account?',
  'onboarding.ration_question': 'What type of ration card do you have?',
  'onboarding.land_question': 'How much land do you own (in acres)? Enter 0 if none.',
  'onboarding.goal_question': 'What is your main financial need right now?',
  'onboarding.goal_placeholder': 'e.g. buy seeds, pay rent, medical treatment',
  'onboarding.goal_amount_question': 'How much money do you need for this?',
  'onboarding.urgency_question': 'How urgent is this need?',
  'onboarding.urgency_1': 'Not urgent',
  'onboarding.urgency_2': 'Somewhat urgent',
  'onboarding.urgency_3': 'Moderately urgent',
  'onboarding.urgency_4': 'Very urgent',
  'onboarding.urgency_5': 'Emergency',

  // Gender options
  'gender.male': 'Male',
  'gender.female': 'Female',
  'gender.transgender': 'Transgender',
  'gender.other': 'Other',
  'gender.prefer_not_to_say': 'Prefer not to say',

  // Caste options
  'caste.general': 'General',
  'caste.obc': 'OBC',
  'caste.sc': 'SC',
  'caste.st': 'ST',
  'caste.nt': 'NT (Nomadic Tribe)',
  'caste.vjnt': 'VJNT (Vimukta Jati)',
  'caste.other': 'Other',

  // Occupation options
  'occupation.farmer': 'Farmer (owns land)',
  'occupation.farm_laborer': 'Farm Labourer',
  'occupation.artisan': 'Artisan / Craftsperson',
  'occupation.self_employed': 'Self-Employed',
  'occupation.daily_wage': 'Daily Wage Worker',
  'occupation.domestic_worker': 'Domestic Worker',
  'occupation.fisherman': 'Fisherman',
  'occupation.weaver': 'Weaver',
  'occupation.construction_worker': 'Construction Worker',
  'occupation.street_vendor': 'Street Vendor',
  'occupation.unemployed': 'Unemployed / Looking for work',
  'occupation.other': 'Other',

  // Yes / No
  'common.yes': 'Yes',
  'common.no': 'No',
  'common.rupees': 'Rupees',
  'common.per_year': 'per year',
  'common.per_month': 'per month',
  'common.free': 'Free',
  'common.apply_now': 'Apply Now',
  'common.learn_more': 'Learn More',
  'common.share': 'Share',
  'common.save': 'Save',
  'common.close': 'Close',
  'common.error': 'Something went wrong. Please try again.',
  'common.loading': 'Loading...',

  // Results page
  'results.title': 'Your Personalised Results',
  'results.schemes_found': '{{count}} Schemes Found',
  'results.insurance_found': '{{count}} Insurance Plans',
  'results.no_results': 'No schemes found for your profile. Try updating your information.',
  'results.score_label': 'Match Score',
  'results.benefit': 'Benefit',
  'results.eligibility': 'You qualify because',
  'results.last_updated': 'Data last updated',

  // Scheme card
  'scheme.apply': 'Apply',
  'scheme.details': 'Details',
  'scheme.benefit_amount': 'Benefit Amount',
  'scheme.ministry': 'Ministry',
  'scheme.tags': 'Categories',

  // Insurance card
  'insurance.premium': 'Annual Premium',
  'insurance.coverage': 'Coverage Amount',
  'insurance.type': 'Coverage Type',
  'insurance.apply': 'Enrol Now',

  // Document checker
  'doc.title': 'Check a Document',
  'doc.subtitle': 'Take a photo of any agreement or contract to understand it',
  'doc.capture': 'Take Photo',
  'doc.upload': 'Upload Image',
  'doc.processing': 'Reading your document...',
  'doc.summary_title': 'What This Document Says',
  'doc.risks_title': 'Caution: Important Points',
  'doc.ask_question': 'Ask a question about this document',
  'doc.no_risk': 'No major risks found',
  'doc.high_risk': 'HIGH RISK — Read carefully before signing',
  'doc.medium_risk': 'MEDIUM RISK — Check these points',

  // Voice
  'voice.tap_to_speak': 'Tap to speak',
  'voice.listening': 'Listening...',
  'voice.processing': 'Processing...',
  'voice.tap_to_stop': 'Tap to stop',

  // Landing page
  'landing.hero_title': 'Find Government Help You Deserve',
  'landing.hero_sub': 'Free. Private. In Your Language.',
  'landing.feature_1_title': 'Government Schemes',
  'landing.feature_1_desc': 'Discover schemes for farmers, women, and workers you qualify for',
  'landing.feature_2_title': 'Cheap Insurance',
  'landing.feature_2_desc': 'Rs.20/year plans that protect your family',
  'landing.feature_3_title': 'Check Documents',
  'landing.feature_3_desc': 'Understand any agreement before you sign',
  'landing.cta': 'Check What You Qualify For',

  // Errors
  'error.network': 'No internet connection. Showing saved results.',
  'error.not_found': 'Page not found',
  'error.generic': 'Something went wrong. Please try again.',
};

export default en;

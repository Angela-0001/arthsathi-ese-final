import pandas as pd
import re

# ── Load raw data ──────────────────────────────────────────────────────────────
df = pd.read_csv('schemes_raw.csv')
print(f"Loaded {len(df)} schemes.")

def clean(text):
    if pd.isna(text):
        return ''
    return str(text).lower()

# ══════════════════════════════════════════════════════════════════════════════
# 1. AGE
# ══════════════════════════════════════════════════════════════════════════════
def is_valid_age(n):
    return n is not None and 5 < float(n) <= 100

def extract_age(text):
    t = clean(text)
    min_age, max_age = None, None

    # Remove "X years of experience/service/working" to avoid false matches
    t = re.sub(r'\d+\s*years?\s*(?:of\s*)?(?:experience|service|working|work|membership|continuous)', '', t)

    # Pattern 1: "age group of 18-60" / "17.5 to 23 years" / "18 to 60 years of age"
    # Now handles decimal ages like 17.5
    m = re.search(r'(?:age[^0-9]{0,20})?(\d{1,2}(?:\.\d)?)\s*(?:to|-|and)\s*(\d{2,3}(?:\.\d)?)\s*years?', t)
    if m:
        a, b = float(m.group(1)), float(m.group(2))
        if is_valid_age(a) and is_valid_age(b):
            # Store as int (round up min, round down max for conservative matching)
            min_age = int(a) if a == int(a) else int(a) + 1
            max_age = int(b)
            return min_age, max_age

    # Pattern 2: "above X years and below Y years"
    m = re.search(r'above\s+(?:the\s+age\s+of\s+)?(\d{1,3}(?:\.\d)?)\s*years?\s*and\s+below\s+(\d{1,3}(?:\.\d)?)\s*years?', t)
    if m:
        a, b = float(m.group(1)), float(m.group(2))
        if is_valid_age(a) and is_valid_age(b):
            return int(min(a,b)), int(max(a,b))

    # Pattern 3: "not less than 18 years"
    m = re.search(r'not\s+(?:be\s+)?less\s+than\s+(\d{1,3}(?:\.\d)?)\s*years?', t)
    if m:
        val = float(m.group(1))
        if is_valid_age(val):
            min_age = int(val)

    # Pattern 4: "above 18 years" / "more than 18 years" / "completed 18 years"
    m = re.search(r'(?:above|more than|completed|attained)\s+(?:the\s+age\s+of\s+)?(\d{1,3}(?:\.\d)?)\s*years?', t)
    if m:
        val = float(m.group(1))
        if is_valid_age(val):
            min_age = int(val)

    # Pattern 5: "below 60 years" / "upto 60 years" / "not more than 60 years"
    m = re.search(r'(?:below|upto|up to|not more than|maximum age of|not exceed)\s+(?:the\s+age\s+of\s+)?(\d{1,3}(?:\.\d)?)\s*years?', t)
    if m:
        val = float(m.group(1))
        if is_valid_age(val):
            max_age = int(val)

    # Pattern 6: "at least 18 years" / "minimum age 18"
    m = re.search(r'(?:at least|minimum|min\.?)\s+(?:age\s+(?:of\s+)?)?(\d{1,3}(?:\.\d)?)\s*years?', t)
    if m:
        val = float(m.group(1))
        if is_valid_age(val):
            min_age = int(val)

    # Pattern 7: "18 years and above"
    m = re.search(r'(\d{1,3}(?:\.\d)?)\s*years?\s*(?:and|or)\s*above', t)
    if m:
        val = float(m.group(1))
        if is_valid_age(val):
            min_age = int(val)

    # Pattern 8: "60 years and below"
    m = re.search(r'(\d{1,3}(?:\.\d)?)\s*years?\s*(?:and|or)\s*below', t)
    if m:
        val = float(m.group(1))
        if is_valid_age(val):
            max_age = int(val)

    return min_age, max_age

# ══════════════════════════════════════════════════════════════════════════════
# 2. INCOME
# ══════════════════════════════════════════════════════════════════════════════
def parse_indian_amount(s):
    s = s.replace(',', '').replace(' ', '').lower()
    m = re.match(r'([\d.]+)\s*(?:lakh|lac)', s)
    if m:
        return int(float(m.group(1)) * 100000)
    m = re.match(r'([\d.]+)\s*crore', s)
    if m:
        return int(float(m.group(1)) * 10000000)
    m = re.match(r'(\d+)', s)
    if m:
        return int(m.group(1))
    return None

def extract_income(text):
    t = clean(text)
    # Remove percentages and area mentions to avoid false matches
    t = re.sub(r'\d+\s*%', '', t)
    t = re.sub(r'\d[\d,]*\s*(?:sq\.?\s*ft|sqft|square\s*feet|sq\.\s*meter|acres?)', '', t)

    income_patterns = [
        r'(?:annual\s+)?(?:family\s+)?income[^₹\d]{0,60}(?:not\s+exceed|below|less\s+than|up\s*to|upto|within|limit|more\s+than|above|exceed)[^₹\d]{0,20}(?:₹|rs\.?|inr)?\s*([\d,]+(?:\.\d+)?\s*(?:lakh|lac|crore)?)',
        r'(?:annual\s+)?(?:family\s+)?income[^₹\d]{0,30}(?:₹|rs\.?|inr)\s*([\d,]+(?:\.\d+)?\s*(?:lakh|lac|crore)?)',
        r'income\s+(?:should\s+)?(?:not\s+exceed|not\s+be\s+more\s+than)\s*(?:₹|rs\.?|inr)?\s*([\d,]+(?:\.\d+)?\s*(?:lakh|lac|crore)?)',
        r'(?:annual\s+)?(?:family\s+)?earning[^₹\d]{0,40}(?:₹|rs\.?|inr)?\s*([\d,]+(?:\.\d+)?\s*(?:lakh|lac|crore)?)',
    ]
    for pat in income_patterns:
        m = re.search(pat, t)
        if m:
            val = parse_indian_amount(m.group(1))
            # Must be between 1000 and 1 crore — rules out ages, percentages, sqft
            if val and 1000 <= val <= 10000000:
                return val
    return None

# ══════════════════════════════════════════════════════════════════════════════
# 3. GENDER
# ══════════════════════════════════════════════════════════════════════════════
def extract_gender(text):
    t = clean(text)
    has_female = bool(re.search(r'\b(woman|women|girl|female|widow|widower|mother|daughter|lady|ladies)\b', t))
    has_male   = bool(re.search(r'\b(man|men|boy|male|father|son)\b', t))
    if has_female and has_male:
        return 'any'
    elif has_female:
        return 'female'
    elif has_male:
        return 'male'
    return 'any'

# ══════════════════════════════════════════════════════════════════════════════
# 4. CASTE
# ══════════════════════════════════════════════════════════════════════════════
def extract_caste(text):
    t = clean(text)
    categories = []
    if re.search(r'\bsc\b|scheduled\s+caste', t):      categories.append('SC')
    if re.search(r'\bst\b|scheduled\s+tribe', t):      categories.append('ST')
    if re.search(r'\bobc\b|other\s+backward', t):      categories.append('OBC')
    if re.search(r'\bminority\b|muslim|christian|sikh|buddhist|jain', t): categories.append('Minority')
    if re.search(r'\bbrahmin\b', t):                   categories.append('Brahmin')
    if re.search(r'\bgeneral\b|\bopen\s+category\b|\ball\s+caste', t): categories.append('General')
    return ','.join(categories) if categories else 'all'

# ══════════════════════════════════════════════════════════════════════════════
# 5. STATE
# ══════════════════════════════════════════════════════════════════════════════
INDIAN_STATES = [
    'andhra pradesh', 'arunachal pradesh', 'assam', 'bihar', 'chhattisgarh',
    'goa', 'gujarat', 'haryana', 'himachal pradesh', 'jharkhand', 'karnataka',
    'kerala', 'madhya pradesh', 'maharashtra', 'manipur', 'meghalaya', 'mizoram',
    'nagaland', 'odisha', 'punjab', 'rajasthan', 'sikkim', 'tamil nadu',
    'telangana', 'tripura', 'uttar pradesh', 'uttarakhand', 'west bengal',
    'delhi', 'jammu and kashmir', 'ladakh', 'puducherry', 'chandigarh',
    'andaman and nicobar', 'dadra and nagar haveli', 'lakshadweep'
]

# Aliases: these alternate spellings all map to the canonical name
STATE_ALIASES = {
    'jammu & kashmir'  : 'Jammu And Kashmir',
    'j&k'              : 'Jammu And Kashmir',
    'j & k'            : 'Jammu And Kashmir',
    'jammu kashmir'    : 'Jammu And Kashmir',
    'pondicherry'      : 'Puducherry',
    'pondicheri'       : 'Puducherry',
    'orissa'           : 'Odisha',
    'uttaranchal'      : 'Uttarakhand',
    'tamilnadu'        : 'Tamil Nadu',
    'andaman'          : 'Andaman And Nicobar',
    'nicobar'          : 'Andaman And Nicobar',
}

def extract_state(scheme_name, details, eligibility):
    combined = clean(scheme_name) + ' ' + clean(details) + ' ' + clean(eligibility)
    found = []

    # Check main state list
    for state in INDIAN_STATES:
        if state in combined:
            found.append(state.title())

    # Check aliases
    for alias, canonical in STATE_ALIASES.items():
        if alias in combined and canonical not in found:
            found.append(canonical)

    if not found:
        return 'all'
    return ','.join(sorted(set(found), key=len, reverse=True)[:3])

# ══════════════════════════════════════════════════════════════════════════════
# 6. OCCUPATION
# ══════════════════════════════════════════════════════════════════════════════
OCCUPATION_KEYWORDS = {
    'farmer':              r'\bfarmer\b|kisan\b|cultivator\b|\bagricultur',
    'fisherman':           r'\bfisher(?:man|men|woman|women)?\b|\bfishing\b',
    'construction_worker': r'\bconstruction\s+worker\b|\bbuilding\s+worker\b|\blabou?rer\b',
    'student':             r'\bstudent\b|\bscholar\b|\bpupil\b',
    'entrepreneur':        r'\bentrepreneur\b|\bmsme\b|\bbusiness\s+owner\b|\bself.?employed\b',
    'woman_shg':           r'\bself\s+help\s+group\b|\bshg\b',
    'artisan':             r'\bartisan\b|\bcraftsman\b|\bweaver\b|\bpotter\b|\bhandloom\b',
    'daily_wage':          r'\bdaily\s+wage\b|\bunorganis(?:ed|ed)\b|\binformal\s+worker\b',
    'pwd':                 r'\bdisabled\b|\bdisability\b|\bdifferently\s+abled\b|\bpwd\b|\bviklang\b',
    'widow':               r'\bwidow\b',
    'bpl':                 r'\bbelow\s+poverty\s+line\b|\bbpl\b',
    'tribal':              r'\btribal\b|\badivasi\b',
}

def extract_occupation(text):
    t = clean(text)
    found = [occ for occ, pat in OCCUPATION_KEYWORDS.items() if re.search(pat, t)]
    return ','.join(found) if found else 'any'

# ══════════════════════════════════════════════════════════════════════════════
# 7. BENEFIT AMOUNT
# ══════════════════════════════════════════════════════════════════════════════
def extract_benefit_amount(text):
    t = clean(text)
    amounts = []
    for m in re.finditer(r'(?:₹|rs\.?|inr)\s*([\d,]+(?:\.\d+)?\s*(?:lakh|lac|crore)?)', t):
        val = parse_indian_amount(m.group(1))
        if val and val >= 100:
            amounts.append(val)
    return max(amounts) if amounts else None

# ══════════════════════════════════════════════════════════════════════════════
# APPLY ALL EXTRACTORS
# ══════════════════════════════════════════════════════════════════════════════
print("Extracting structured fields...")

ages                     = df['eligibility'].apply(extract_age)
df['min_age']            = ages.apply(lambda x: x[0])
df['max_age']            = ages.apply(lambda x: x[1])
df['max_income_inr']     = df['eligibility'].apply(extract_income)
df['gender']             = (df['eligibility'].fillna('') + ' ' + df['details'].fillna('')).apply(extract_gender)
df['caste_category']     = (df['eligibility'].fillna('') + ' ' + df['details'].fillna('')).apply(extract_caste)
df['state_name']         = df.apply(lambda r: extract_state(r['scheme_name'], r['details'], r['eligibility']), axis=1)
df['occupation']         = (df['eligibility'].fillna('') + ' ' + df['details'].fillna('')).apply(extract_occupation)
df['benefit_amount_inr'] = df['benefits'].apply(extract_benefit_amount)

df = df.drop(columns=['Unnamed: 9'], errors='ignore')

# ── Post-processing: fix min_age >= max_age ───────────────────
bad_age = df['min_age'].notna() & df['max_age'].notna() & (df['min_age'] >= df['max_age'])
# Case 1: min < max but got placed wrong (e.g. min=60, max=18) → swap
swappable = bad_age & (df['max_age'] < df['min_age'])
df.loc[swappable, ['min_age', 'max_age']] = df.loc[swappable, ['max_age', 'min_age']].values
# Case 2: min == max (same number) → clear max_age, keep min_age
equal_age = df['min_age'].notna() & df['max_age'].notna() & (df['min_age'] == df['max_age'])
df.loc[equal_age, 'max_age'] = None
fixed = int(bad_age.sum())
print(f"Fixed {fixed} rows with bad age ranges")

df.to_csv('schemes_processed.csv', index=False)
print("Done. Saved schemes_processed.csv")

import psycopg2, os
from dotenv import load_dotenv
load_dotenv('.env')
conn = psycopg2.connect(host=os.getenv('DB_HOST'), port=int(os.getenv('DB_PORT')), dbname=os.getenv('DB_NAME'), user=os.getenv('DB_USER'), password=os.getenv('DB_PASSWORD'))
conn.autocommit = True
cur = conn.cursor()

# Get all NOT NULL columns in users table
cur.execute("""
    SELECT column_name, column_default 
    FROM information_schema.columns 
    WHERE table_name='users' AND is_nullable='NO' AND column_name != 'id'
""")
cols = cur.fetchall()
print("NOT NULL columns:", [r[0] for r in cols])

# Make them all nullable or give defaults
fixes = [
    "ALTER TABLE users ALTER COLUMN phone DROP NOT NULL",
    "ALTER TABLE users ALTER COLUMN aadhaar_verified SET DEFAULT FALSE",
]
for f in fixes:
    try:
        cur.execute(f)
        print(f"✅ {f}")
    except Exception as e:
        print(f"⚠️  {f}: {e}")

conn.close()
print("Done")

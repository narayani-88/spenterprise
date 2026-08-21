-- Table creation (Safe mode: preserves existing data)
CREATE TABLE IF NOT EXISTS income_types (
  code VARCHAR(30) PRIMARY KEY,
  label VARCHAR(60) NOT NULL,
  description TEXT
);
-- Lookup tables
INSERT INTO income_types VALUES
  ('referral_income',       'Referral Income',         'One-time ₹2,000 when referral code used at joining'),
  ('pair_income',           'Pair Income (Daily)',      'Daily pair matching income, max ₹10,000/day'),
  ('milestone_commission',  'Milestone Bonus',          'One-time ₹10,000 bonus when 10 total pairs reached'),
  ('smi_family_bonus',      'SMI Family Bonus',         '20% cascade up sponsor chain on 10-pair milestone'),
  ('non_working_income',    'Non-Working Income',       'Recurring milestone payout based on AM referral count'),
  ('jackpot_reward',        'Jackpot Reward',           'Plot reward at 6/36/216 AM milestone'),
  ('cgm_monthly_income',    'CGM Monthly Income',       'Monthly income for CGM rank from company fund'),
  ('deposit',               'Fund Deposit',             'Member fund deposit'),
  ('withdrawal',            'Withdrawal',               'Funds withdrawn by member'),
  ('tds_deduction',         'TDS Deduction (5%)',       '5% TDS deducted at withdrawal'),
  ('nwi_deduction',         'NWI Deduction (10%)',      '10% Non-Working Income deducted at withdrawal')
ON CONFLICT (code) DO NOTHING;

-- Rank ladder (12 tiers total: SA base + 11 promotion tiers)
CREATE TABLE IF NOT EXISTS ranks (
  code          VARCHAR(20) PRIMARY KEY,
  name          VARCHAR(60) NOT NULL,
  short_name    VARCHAR(30),
  req_type      VARCHAR(20) DEFAULT 'am_count', -- 'deposit' | 'am_count'
  req_value     INT DEFAULT 0,
  sort_order    INT NOT NULL,
  reward_title  VARCHAR(255),
  reward_value  VARCHAR(100)
);

ALTER TABLE ranks ALTER COLUMN short_name TYPE VARCHAR(30);
ALTER TABLE ranks ADD COLUMN IF NOT EXISTS reward_title VARCHAR(255);
ALTER TABLE ranks ADD COLUMN IF NOT EXISTS reward_value VARCHAR(100);

INSERT INTO ranks (code, name, short_name, req_type, req_value, sort_order, reward_title, reward_value) VALUES
  ('SA',          'Sales Associate',          'S.A.',   'deposit',   1,     0,  'S.A. Club Fund + Non-working monthly income', 'Fund Pool'),
  ('AM',          'Area Manager',             'A.M.',   'am_count',  6,     1,  'Non-working income starts', 'NWF Active'),
  ('ZM',          'Zone Manager',             'Z.M.',   'am_count',  3,     2,  'Tab Gift', '₹15,000'),
  ('ACM_CITY',    'Addl. City Manager',       'A.C.M. (City)',    'am_count',  9,     3,  'Electric Bike + RTO + Goa Trip', '₹30,000'),
  ('CM_CITY',     'City Manager',             'C.M. (City)',      'am_count',  27,    4,  'Electric Bike (non-RTO)', '₹60,000'),
  ('ADM',         'Addl. District Manager',   'A.D.M.',           'am_count',  81,    5,  'Car Down Payment', '₹1,50,000'),
  ('DM',          'District Manager',         'D.M.',             'am_count',  200,   6,  'Flat — EMI Support (12 Months)', '₹30,000/month'),
  ('ASM',         'Addl. State Manager',      'A.S.M.',           'am_count',  500,   7,  'Flat — EMI Support (12 Months)', '₹50,000/month'),
  ('SM',          'State Manager',            'S.M.',             'am_count',  1000,  8,  '20x40 Plot', '₹12,00,000'),
  ('ACM_COUNTRY', 'Addl. Country Manager',    'A.C.M. (Country)', 'am_count',  2500,  9,  'Electric Car', '₹25,00,000'),
  ('CM_COUNTRY',  'Country Manager',          'C.M. (Country)',   'am_count',  5000,  10, '2BHK Flat & Bungalow', '₹50,00,000'),
  ('CHM',         'Country Head Manager',     'C.H.M.', 'am_count',  10000, 11, 'Monthly Lifetime Income', '₹1,00,000/month')
ON CONFLICT (code) DO UPDATE SET
  name=EXCLUDED.name,
  short_name=EXCLUDED.short_name,
  req_value=EXCLUDED.req_value,
  sort_order=EXCLUDED.sort_order,
  reward_title=EXCLUDED.reward_title,
  reward_value=EXCLUDED.reward_value;

CREATE TABLE IF NOT EXISTS users (
  id                SERIAL PRIMARY KEY,
  member_id         VARCHAR(20) UNIQUE NOT NULL,  -- BAP0001, BAP0002... used for login + chain tracking
  source_type       VARCHAR(20) DEFAULT 'REAL_USER' CHECK (source_type IN ('REAL_USER','COMPANY_PLACED')),
  name              VARCHAR(255) NOT NULL,
  email             VARCHAR(255) UNIQUE NOT NULL,
  phone             VARCHAR(20),
  age               INT,
  address           TEXT,
  qualification     VARCHAR(100),
  purpose           VARCHAR(10),        -- 'learn' | 'earn'
  password_hash     VARCHAR(255) NOT NULL,
  role              VARCHAR(20) DEFAULT 'user' CHECK (role IN ('admin','user')),
  referral_code     VARCHAR(20) UNIQUE NOT NULL,
  sponsor_id        INT REFERENCES users(id) ON DELETE SET NULL,  -- person who added/recruited
  referred_by       INT REFERENCES users(id) ON DELETE SET NULL,  -- referral code used (may differ)
  utr_number        VARCHAR(50) UNIQUE,
  parent_id         INT REFERENCES users(id) ON DELETE SET NULL,  -- binary tree placement parent
  position          VARCHAR(5) CHECK (position IN ('left','right')),
  left_child_id     INT,
  right_child_id    INT,
  -- PV (Point Volume) — ₹12,500 = 1 PV
  left_pv           DECIMAL(10,2) DEFAULT 0,   -- accumulated PV in left subtree (carry-forward)
  right_pv          DECIMAL(10,2) DEFAULT 0,   -- accumulated PV in right subtree
  total_pairs       INT DEFAULT 0,             -- lifetime pairs matched
  -- Wallet
  wallet_balance    DECIMAL(12,2) DEFAULT 0,
  pending_balance   DECIMAL(12,2) DEFAULT 0,
  total_deposited   DECIMAL(12,2) DEFAULT 0,
  is_active         BOOLEAN DEFAULT false,
  milestone_triggered BOOLEAN DEFAULT false,   -- 10-pair SMI ever triggered
  -- Rank
  current_rank      VARCHAR(20) DEFAULT 'SA' REFERENCES ranks(code),
  rank_updated_at   TIMESTAMP,
  -- KYC
  kyc_status        VARCHAR(20) DEFAULT 'not_submitted' CHECK (kyc_status IN ('not_submitted','pending','approved','rejected')),
  pan_number        VARCHAR(20),
  aadhar_number     VARCHAR(20),
  bank_name         VARCHAR(100),
  bank_account      VARCHAR(30),
  bank_ifsc         VARCHAR(15),
  nominee_name      VARCHAR(100),
  nominee_relation  VARCHAR(50),
  nominee_age       INT,
  photo_url         VARCHAR(255),
  created_at        TIMESTAMP DEFAULT NOW(),
  updated_at        TIMESTAMP DEFAULT NOW()
);

-- Deposits
CREATE TABLE IF NOT EXISTS deposits (
  id            SERIAL PRIMARY KEY,
  user_id       INT REFERENCES users(id) ON DELETE CASCADE NOT NULL,
  amount        DECIMAL(12,2) NOT NULL,
  utr_number    VARCHAR(50) NOT NULL,
  status        VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  verified_by   INT REFERENCES users(id),
  notes         TEXT,
  created_at    TIMESTAMP DEFAULT NOW(),
  verified_at   TIMESTAMP
);

-- Transactions / Income log (extensible via income_types)
CREATE TABLE IF NOT EXISTS transactions (
  id              SERIAL PRIMARY KEY,
  user_id         INT REFERENCES users(id) ON DELETE CASCADE NOT NULL,
  income_type     VARCHAR(30) REFERENCES income_types(code) NOT NULL,
  amount          DECIMAL(12,2) NOT NULL,
  tds_rate        DECIMAL(5,2) DEFAULT 0,
  tds_amount      DECIMAL(12,2) DEFAULT 0,
  net_amount      DECIMAL(12,2),
  description     TEXT,
  status          VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending','credited')),
  related_user_id INT REFERENCES users(id) ON DELETE SET NULL,
  attributed_to   VARCHAR(20) DEFAULT 'REAL_USER' CHECK (attributed_to IN ('REAL_USER','COMPANY_PLACED')),
  created_at      TIMESTAMP DEFAULT NOW()
);

-- Daily pair matching log
CREATE TABLE IF NOT EXISTS daily_pair_log (
  id                  SERIAL PRIMARY KEY,
  user_id             INT REFERENCES users(id) ON DELETE CASCADE NOT NULL,
  log_date            DATE NOT NULL,
  left_pv_start       DECIMAL(10,2) DEFAULT 0,
  right_pv_start      DECIMAL(10,2) DEFAULT 0,
  pairs_matched       INT DEFAULT 0,
  amount_paid         DECIMAL(12,2) DEFAULT 0,
  left_pv_carry       DECIMAL(10,2) DEFAULT 0,  -- stronger leg carries forward
  right_pv_carry      DECIMAL(10,2) DEFAULT 0,
  left_pv_flushed     DECIMAL(10,2) DEFAULT 0,  -- weaker leg lost (grey)
  right_pv_flushed    DECIMAL(10,2) DEFAULT 0,
  smi_triggered       BOOLEAN DEFAULT false,
  attributed_to       VARCHAR(20) DEFAULT 'REAL_USER',
  created_at          TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id, log_date)
);

-- Non-working income milestone log
CREATE TABLE IF NOT EXISTS non_working_income_log (
  id            SERIAL PRIMARY KEY,
  user_id       INT REFERENCES users(id) NOT NULL,
  am_count      INT NOT NULL,
  amount        DECIMAL(12,2) NOT NULL,
  status        VARCHAR(20) DEFAULT 'pending',
  triggered_at  TIMESTAMP DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- MONEY FLOW & ACCOUNT SYSTEM (Three-Tier Ledger)
-- ═══════════════════════════════════════════════════════════════════════════════

-- Wallets: Five sub-ledgers under the Mega Account per corrected accounting spec
--   MEGA_ACCOUNT   — Company master treasury (every rupee ever received)
--   COMPANY_EARNED — Clean profit from company-placed ID pair/referral income ONLY
--   USER_PAYABLE   — Real user's withdrawable earnings (user liabilities)
--   TDS_PAYABLE    — 5% statutory tax withheld from withdrawals (Government liability)
--   NWF_POOL       — 10% Non-Working Fund withheld from withdrawals (Retention pool)
CREATE TABLE IF NOT EXISTS wallets (
  id            SERIAL PRIMARY KEY,
  owner_id      INT REFERENCES users(id) ON DELETE CASCADE,  -- NULL for company-level wallets
  wallet_type   VARCHAR(20) NOT NULL CHECK (wallet_type IN ('USER_PAYABLE', 'COMPANY_EARNED', 'MEGA_ACCOUNT', 'TDS_PAYABLE', 'NWF_POOL')),
  balance       DECIMAL(14,2) DEFAULT 0,
  created_at    TIMESTAMP DEFAULT NOW(),
  updated_at    TIMESTAMP DEFAULT NOW()
);

-- Ensure only one company-level wallet row per wallet_type when owner_id IS NULL
CREATE UNIQUE INDEX IF NOT EXISTS idx_company_wallets_unique ON wallets (wallet_type) WHERE owner_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_wallets_unique ON wallets (owner_id, wallet_type) WHERE owner_id IS NOT NULL;

-- Mega Ledger: Immutable append-only audit trail for ALL money movements
-- Every rupee entering, leaving, or being re-tagged inside the system is logged here.
CREATE TABLE IF NOT EXISTS mega_ledger (
  id                SERIAL PRIMARY KEY,
  transaction_type  VARCHAR(30) NOT NULL CHECK (transaction_type IN ('INFLOW', 'OUTFLOW', 'INTERNAL_ALLOCATION')),
  category          VARCHAR(40) NOT NULL,  -- deposit, pair_match, referral, withdrawal, smi_bonus, etc.
  amount            DECIMAL(14,2) NOT NULL,
  related_wallet_id INT REFERENCES wallets(id),
  related_user_id   INT REFERENCES users(id),
  description       TEXT,
  created_at        TIMESTAMP DEFAULT NOW()
);

-- Withdrawal Requests: Full withdrawal lifecycle
-- User requests → Admin approves → 5% TDS + 10% NWI deducted → net paid out
CREATE TABLE IF NOT EXISTS withdrawal_requests (
  id              SERIAL PRIMARY KEY,
  user_id         INT REFERENCES users(id) ON DELETE CASCADE NOT NULL,
  requested_amount DECIMAL(12,2) NOT NULL,   -- gross amount user wants to withdraw
  tds_rate        DECIMAL(5,2) DEFAULT 5.00,  -- 5% TDS
  tds_amount      DECIMAL(12,2) DEFAULT 0,
  nwi_rate        DECIMAL(5,2) DEFAULT 10.00, -- 10% Non-Working Income deduction
  nwi_amount      DECIMAL(12,2) DEFAULT 0,
  net_amount      DECIMAL(12,2) DEFAULT 0,    -- amount after deductions (85% of requested)
  status          VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','processing')),
  approved_by     INT REFERENCES users(id),
  notes           TEXT,
  created_at      TIMESTAMP DEFAULT NOW(),
  processed_at    TIMESTAMP
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_users_member_id ON users(member_id);
CREATE INDEX IF NOT EXISTS idx_users_parent   ON users(parent_id);
CREATE INDEX IF NOT EXISTS idx_users_sponsor  ON users(sponsor_id);
CREATE INDEX IF NOT EXISTS idx_users_referral ON users(referral_code);
CREATE INDEX IF NOT EXISTS idx_users_rank     ON users(current_rank);
CREATE INDEX IF NOT EXISTS idx_deposits_user  ON deposits(user_id);
CREATE INDEX IF NOT EXISTS idx_deposits_status ON deposits(status);
CREATE INDEX IF NOT EXISTS idx_txns_user      ON transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_daily_log_date ON daily_pair_log(log_date);
CREATE INDEX IF NOT EXISTS idx_wallets_owner  ON wallets(owner_id);
CREATE INDEX IF NOT EXISTS idx_wallets_type   ON wallets(wallet_type);
CREATE INDEX IF NOT EXISTS idx_mega_ledger_type ON mega_ledger(transaction_type);
CREATE INDEX IF NOT EXISTS idx_mega_ledger_cat  ON mega_ledger(category);
CREATE INDEX IF NOT EXISTS idx_withdrawal_user  ON withdrawal_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_withdrawal_status ON withdrawal_requests(status);

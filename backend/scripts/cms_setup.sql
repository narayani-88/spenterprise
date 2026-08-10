-- ── CMS CONTENT TABLE ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cms_content (
  key        VARCHAR(100) PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── CONTACT SUBMISSIONS TABLE ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS contact_submissions (
  id         SERIAL PRIMARY KEY,
  name       VARCHAR(200) NOT NULL,
  email      VARCHAR(200),
  phone      VARCHAR(20),
  message    TEXT NOT NULL,
  is_read    BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── DEFAULT WEBSITE CONTENT ───────────────────────────────────────────────────
INSERT INTO cms_content (key, value) VALUES
  ('hero_headline',       'Build Your Future with SP Enterprise'),
  ('hero_subheadline',    'Join India''s fastest-growing network marketing community. Earn daily pair income, referral bonuses, and milestone rewards — all from one powerful platform.'),
  ('hero_cta_primary',    'Join Now'),
  ('hero_cta_secondary',  'Learn More'),
  ('about_company_name',  'SP Enterprise Pvt. Ltd.'),
  ('about_description',   'SP Enterprise is a premier network marketing company built on transparency, trust, and cutting-edge technology. We empower individuals across India to achieve true financial freedom through our proven binary MLM system, with guaranteed daily income and milestone rewards.'),
  ('about_stat_members',  '10,000+'),
  ('about_stat_years',    '5+'),
  ('about_stat_paid',     '₹2 Crore+'),
  ('about_stat_cities',   '50+'),
  ('about_mission',       'Our mission is to create a transparent, rewarding, and sustainable business opportunity for every individual regardless of background.'),
  ('contact_phone',       '+91 98765 43210'),
  ('contact_email',       'support@spenterprise.com'),
  ('contact_address',     'SP Enterprise Pvt. Ltd., 123 Business Hub, Mumbai, Maharashtra - 400001'),
  ('contact_upi',         'spenterprise@upi'),
  ('contact_bank_name',   'State Bank of India'),
  ('contact_account_no',  'XXXXXXXXXX'),
  ('contact_ifsc',        'SBIN0000000'),
  ('company_tagline',     'Your Success is Our Mission'),
  ('footer_copyright',    '© 2024 SP Enterprise Pvt. Ltd. All rights reserved.')
ON CONFLICT (key) DO NOTHING;

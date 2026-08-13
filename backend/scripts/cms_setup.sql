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
  ('hero_headline',       'Invest in Premium Real Estate & Build Generational Wealth'),
  ('hero_subheadline',    'Join India''s premier fractional real estate networking portal. Purchase high-yield property shares, earn daily pair matching commissions, referral bonuses, and luxury milestone rewards.'),
  ('hero_cta_primary',    'Start Investing'),
  ('hero_cta_secondary',  'Explore Properties'),
  ('about_company_name',  'SP Realty Ventures Pvt. Ltd.'),
  ('about_description',   'SP Realty Ventures is a leading real estate investment and networking firm dedicated to democratizing property ownership. Through our automated binary referral system, we allow individuals across India to participate in premium commercial and residential developments with high yield potential, transparent daily income payouts, and exclusive milestone incentives.'),
  ('about_stat_members',  '12,000+'),
  ('about_stat_years',    '6+'),
  ('about_stat_paid',     '₹5 Crore+'),
  ('about_stat_cities',   '60+'),
  ('about_mission',       'Our mission is to make premium real estate investment accessible, transparent, and highly rewarding for everyone through network-driven fractional ownership.'),
  ('contact_phone',       '+91 98765 43210'),
  ('contact_email',       'invest@sprealtyventures.com'),
  ('contact_address',     'SP Realty Hub, Suite 402, BKC, Mumbai, Maharashtra - 400051'),
  ('contact_upi',         'sprealty@upi'),
  ('contact_bank_name',   'HDFC Bank'),
  ('contact_account_no',  '50200012345678'),
  ('contact_ifsc',        'HDFC0000123'),
  ('company_tagline',     'Your Gateway to Luxury Property Wealth'),
  ('footer_copyright',    '© 2026 SP Realty Ventures Pvt. Ltd. All rights reserved.'),
  ('feature_1_title',     'Property Share Binary Engine'),
  ('feature_1_desc',      'Automated daily pair matching system on property shares, capped at 10 pairs/day with carry-forward options.'),
  ('feature_2_title',     'Secure Asset Verification'),
  ('feature_2_desc',      'Instant verification of banking and UPI deposits to activate your property ownership position and start earning yields.'),
  ('feature_3_title',     'Cascading SMI Family Bonus'),
  ('feature_3_desc',      'Unlock premium rewards and trigger automated 20% cascading SMI family bonuses as your property downline expands.'),
  ('feature_4_title',     'Transparent Property Ledger'),
  ('feature_4_desc',      'Track your complete upline, downline, active assets, and referral history in real-time with zero hidden fees.'),
  ('cta_title',           'Ready to Start Your Property Portfolio?'),
  ('cta_subtitle',        'Secure your position in India''s fastest growing real estate network. Contact a sponsor or sign in to get started.'),
  ('cta_btn_text',        'Access Investor Portal →')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;



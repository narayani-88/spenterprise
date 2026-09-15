-- ── CMS CONTENT TABLE ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cms_content (
  key        VARCHAR(100) PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS cms_content_key_uidx ON cms_content (key);

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
  ('hero_headline',       'Book Your Dream Plot & Build Generational Wealth'),
  ('hero_subheadline',    'Explore premium residential plots with Book Mera Plot. Discover thoughtfully selected properties in promising locations, with transparent pricing, clear documentation, and reliable support to help you make confident property decisions.'),
  ('hero_cta_primary',    'Start Investing'),
  ('hero_cta_secondary',  'Explore Plots'),
  ('about_company_name',  'Book Mera Plot'),
  ('about_description',   'Book Mera Plot is a trusted real estate company dedicated to making property ownership simple, transparent, and accessible across India. We offer carefully selected residential plots and property opportunities in promising locations, helping individuals and families make confident real estate decisions. With a focus on clear documentation, transparent pricing, quality developments, and reliable customer support, we aim to make every property investment secure and rewarding.'),
  ('about_stat_members',  '12,000+'),
  ('about_stat_years',    '6+'),
  ('about_stat_paid',     '₹5 Crore+'),
  ('about_stat_cities',   '60+'),
  ('about_mission',       'Discover premium plots in promising locations with transparent pricing, clear documentation, and trusted real estate support.'),
  ('contact_phone',       '88666 96326'),
  ('contact_email',       'invest@bookmeraplot.com'),
  ('contact_address',     '5th floor, Blue Stone Building, Near - Indriya Jwellers, Ghode Doud Road Surat Gujarat'),
  ('contact_upi',         'bookmeraplot@upi'),
  ('contact_bank_name',   'HDFC Bank'),
  ('contact_account_no',  '50200012345678'),
  ('contact_ifsc',        'HDFC0000123'),
  ('company_tagline',     'Your Gateway to Premium Plot Ownership'),
  ('footer_copyright',    '© 2026 Book Mera Plot (bookmeraplot.com). All rights reserved.'),
  ('feature_1_title',     'Premium Plot Selection'),
  ('feature_1_desc',      'Explore carefully selected residential plots in promising locations that match your needs and budget.'),
  ('feature_2_title',     'Transparent Pricing'),
  ('feature_2_desc',      'Get clear property pricing and applicable charges upfront for a simple and transparent buying experience.'),
  ('feature_3_title',     'Verified Property Details'),
  ('feature_3_desc',      'Access essential plot information, project details, and available documentation before making your decision.'),
  ('feature_4_title',     'Secure Buying Assistance'),
  ('feature_4_desc',      'Get dedicated support throughout your property journey, from plot selection and booking to documentation and ownership.'),
  ('cta_title',           'Ready to Start Your Property Portfolio?'),
  ('cta_subtitle',        'Secure your position in India''s fastest growing real estate network. Contact a sponsor or sign in to get started.'),
  ('cta_btn_text',        'Access Investor Portal →')
ON CONFLICT (key) DO NOTHING;  -- Preserve existing custom content

-- ── PROPERTIES TABLE (Plots Showcase for PLP/PDP) ──────────────────────────
CREATE TABLE IF NOT EXISTS properties (
  id              SERIAL PRIMARY KEY,
  title           VARCHAR(255) NOT NULL,
  property_type   VARCHAR(50) DEFAULT 'Residential Plot',
  price           NUMERIC(14, 2) NOT NULL,
  price_display   VARCHAR(100),
  area_sqft       NUMERIC(10, 2),
  dimensions      VARCHAR(100),
  facing          VARCHAR(50),
  road_width      VARCHAR(50),
  address         TEXT NOT NULL,
  city            VARCHAR(100),
  state           VARCHAR(100),
  pincode         VARCHAR(20),
  features        TEXT,
  contact_number  VARCHAR(30) NOT NULL,
  whatsapp_number VARCHAR(30),
  images          TEXT,
  video_url       TEXT,
  description     TEXT,
  status          VARCHAR(30) DEFAULT 'available',
  is_featured     BOOLEAN DEFAULT false,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Seed initial sample properties if table is empty
INSERT INTO properties (
  title, property_type, price, price_display, area_sqft, dimensions,
  facing, road_width, address, city, state, pincode, features,
  contact_number, whatsapp_number, images, video_url, description,
  status, is_featured
)
SELECT
  'Green Meadows Premium Residential Plot #42',
  'Residential Plot',
  1800000,
  '₹18,00,000 (₹1,500/sq.ft)',
  1200,
  '30 ft x 40 ft',
  'East Facing',
  '40 ft Wide Main Sector Road',
  'Plot #42, Sector 18, Express Highway Corridor',
  'Jaipur',
  'Rajasthan',
  '302020',
  '["Immediate Registry & Mutation", "RERA Approved Project", "Gated Township with Security", "40ft Wide Blacktop Road", "Underground Electricity & Water Supply", "Park & Clubhouse Facing", "Clear Freehold Title"]',
  '+91 98765 43210',
  '+91 98765 43210',
  '["https://images.unsplash.com/photo-1500382017468-9049fed747ef?auto=format&fit=crop&w=1200&q=80", "https://images.unsplash.com/photo-1628744448840-55bdb2497bd4?auto=format&fit=crop&w=1200&q=80", "https://images.unsplash.com/photo-1513694203232-719a280e022f?auto=format&fit=crop&w=1200&q=80"]',
  'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  'Prime East-facing residential plot located in the prestigious Green Meadows Township. Perfect for immediate villa construction or high-yield investment. Fully developed infrastructure including street lighting, sewer connections, and dedicated green park. 5-minute drive to National Highway and metro station.',
  'available',
  true
WHERE NOT EXISTS (SELECT 1 FROM properties WHERE id = 1);

INSERT INTO properties (
  title, property_type, price, price_display, area_sqft, dimensions,
  facing, road_width, address, city, state, pincode, features,
  contact_number, whatsapp_number, images, video_url, description,
  status, is_featured
)
SELECT
  'Royal Palms Highway Commercial Corner Plot',
  'Commercial Plot',
  4800000,
  '₹48,00,000 (₹2,000/sq.ft)',
  2400,
  '40 ft x 60 ft',
  'North-East Corner Facing',
  '60 ft Highway Touch Road',
  'Plot C-08, Royal Commercial Park, Airport Bypass Road',
  'Pune',
  'Maharashtra',
  '411045',
  '["Commercial Land Use NOC", "60ft Main Highway Touch", "Corner Dual-Facing Plot", "3-Phase Electricity Connection", "Heavy Vehicle Access", "Immediate Possession"]',
  '+91 98765 43210',
  '+91 98765 43210',
  '["https://images.unsplash.com/photo-1524813686514-a57563d77d61?auto=format&fit=crop&w=1200&q=80", "https://images.unsplash.com/photo-1582407947304-fd86f028f716?auto=format&fit=crop&w=1200&q=80", "https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?auto=format&fit=crop&w=1200&q=80"]',
  'https://www.youtube.com/watch?v=ScMzIvxBSi4',
  'High-visibility commercial corner plot with dual frontage on a 60ft main bypass road. Ideal for retail showrooms, corporate offices, restaurants, or warehousing. Clear commercial registry and approvals ready.',
  'available',
  true
WHERE NOT EXISTS (SELECT 1 FROM properties WHERE id = 2);

INSERT INTO properties (
  title, property_type, price, price_display, area_sqft, dimensions,
  facing, road_width, address, city, state, pincode, features,
  contact_number, whatsapp_number, images, video_url, description,
  status, is_featured
)
SELECT
  'Serene Valley Luxury Farmhouse & Villa Plot',
  'Villa Plot',
  3500000,
  '₹35,00,000 (₹777/sq.ft)',
  4500,
  '50 ft x 90 ft',
  'North Facing',
  '30 ft Internal Tree-Lined Road',
  'Plot V-19, Serene Valley Agro Greens, Mussoorie Foothills',
  'Dehradun',
  'Uttarakhand',
  '248001',
  '["Scenic Mountain Foothill View", "Fenced & Gated Boundary", "Clubhouse & Swimming Pool Access", "Solar Street Lighting", "Perpetual Groundwater Borewell", "Clean Pollution-Free Environment"]',
  '+91 98765 43210',
  '+91 98765 43210',
  '["https://images.unsplash.com/photo-1506744038136-46273834b3fb?auto=format&fit=crop&w=1200&q=80", "https://images.unsplash.com/photo-1512917774080-9991f1c4c750?auto=format&fit=crop&w=1200&q=80"]',
  'https://www.youtube.com/watch?v=ysz5S6PUM-U',
  'Sprawling 4,500 sq.ft villa and farmhouse plot nestled against the scenic foothills. Features organic soil, clean mountain air, dedicated borewell water supply, and 24/7 security. Perfect for a luxury weekend getaway home.',
  'available',
  true
WHERE NOT EXISTS (SELECT 1 FROM properties WHERE id = 3);

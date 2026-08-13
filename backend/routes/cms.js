const router = require('express').Router();
const pool   = require('../db');
const jwt    = require('jsonwebtoken');
require('dotenv').config();

const CMS_SECRET   = process.env.CMS_JWT_SECRET   || 'cms-super-secret-key-change-in-prod';
const CMS_EMAIL    = process.env.CMS_ADMIN_EMAIL   || 'cms@sprealtyventures.com';
const CMS_PASSWORD = process.env.CMS_ADMIN_PASSWORD || 'CmsAdmin@123';

// Auto-initialize CMS DB tables & default content if not present
(async function initCMSTables() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS cms_content (
        key        VARCHAR(100) PRIMARY KEY,
        value      TEXT NOT NULL,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS contact_submissions (
        id         SERIAL PRIMARY KEY,
        name       VARCHAR(200) NOT NULL,
        email      VARCHAR(200),
        phone      VARCHAR(20),
        message    TEXT NOT NULL,
        is_read    BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
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
      ON CONFLICT (key) DO NOTHING;
    `);
  } catch (err) {
    console.error('CMS Table Auto-Init Warning:', err.message);
  }
})();

// ── CMS Admin Auth Middleware ─────────────────────────────────────────────────
function cmsAuth(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer '))
    return res.status(401).json({ error: 'CMS authentication required' });
  try {
    req.cmsUser = jwt.verify(auth.split(' ')[1], CMS_SECRET);
    if (req.cmsUser.role !== 'cms_admin')
      return res.status(403).json({ error: 'CMS admin access only' });
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired CMS token' });
  }
}

// ── POST /api/cms/login ───────────────────────────────────────────────────────
router.post('/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ error: 'Email and password required' });
  if (email.trim().toLowerCase() !== CMS_EMAIL.toLowerCase() || password !== CMS_PASSWORD)
    return res.status(401).json({ error: 'Invalid CMS credentials' });

  const token = jwt.sign(
    { role: 'cms_admin', email: CMS_EMAIL },
    CMS_SECRET,
    { expiresIn: '24h' }
  );
  res.json({ token, email: CMS_EMAIL, role: 'cms_admin' });
});

// ── GET /api/cms/content — PUBLIC (no auth needed) ────────────────────────────
router.get('/content', async (req, res) => {
  try {
    const result = await pool.query('SELECT key, value FROM cms_content ORDER BY key');
    const content = {};
    result.rows.forEach(r => { content[r.key] = r.value; });
    res.json(content);
  } catch (err) {
    console.error('CMS content fetch error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── PUT /api/cms/content — CMS Admin only ─────────────────────────────────────
router.put('/content', cmsAuth, async (req, res) => {
  const updates = req.body;
  if (!updates || typeof updates !== 'object' || Array.isArray(updates))
    return res.status(400).json({ error: 'Invalid content payload. Expected a key-value object.' });

  try {
    const allowedKeys = [
      'hero_headline','hero_subheadline','hero_cta_primary','hero_cta_secondary',
      'about_company_name','about_description','about_stat_members','about_stat_years',
      'about_stat_paid','about_stat_cities','about_mission',
      'contact_phone','contact_email','contact_address','contact_upi',
      'contact_bank_name','contact_account_no','contact_ifsc',
      'company_tagline','footer_copyright',
      'feature_1_title','feature_1_desc',
      'feature_2_title','feature_2_desc',
      'feature_3_title','feature_3_desc',
      'feature_4_title','feature_4_desc',
      'cta_title','cta_subtitle','cta_btn_text'
    ];


    for (const [key, value] of Object.entries(updates)) {
      if (!allowedKeys.includes(key)) continue; // silently skip unknown keys
      await pool.query(
        `INSERT INTO cms_content (key, value, updated_at) VALUES ($1, $2, NOW())
         ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
        [key, String(value)]
      );
    }
    res.json({ message: 'Content updated successfully' });
  } catch (err) {
    console.error('CMS content update error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── POST /api/cms/contact — PUBLIC contact form submission ────────────────────
router.post('/contact', async (req, res) => {
  const { name, email, phone, message } = req.body;

  if (!name || !name.trim())
    return res.status(400).json({ error: 'Name is required' });
  if (!message || !message.trim())
    return res.status(400).json({ error: 'Message is required' });
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))
    return res.status(400).json({ error: 'Invalid email address' });
  if (message.trim().length < 10)
    return res.status(400).json({ error: 'Message must be at least 10 characters' });

  try {
    await pool.query(
      `INSERT INTO contact_submissions (name, email, phone, message)
       VALUES ($1, $2, $3, $4)`,
      [name.trim(), email?.trim() || null, phone?.trim() || null, message.trim()]
    );
    res.json({ message: 'Thank you for reaching out! Our team will contact you soon.' });
  } catch (err) {
    console.error('Contact form error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── GET /api/cms/contacts — CMS Admin: view submissions ──────────────────────
router.get('/contacts', cmsAuth, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM contact_submissions ORDER BY created_at DESC LIMIT 200'
    );
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// ── POST /api/cms/contacts/:id/read — CMS Admin: mark read ───────────────────
router.post('/contacts/:id/read', cmsAuth, async (req, res) => {
  try {
    await pool.query('UPDATE contact_submissions SET is_read=true WHERE id=$1', [req.params.id]);
    res.json({ message: 'Marked as read' });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

module.exports = router;

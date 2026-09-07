const router = require('express').Router();
const pool   = require('../db');
const jwt    = require('jsonwebtoken');
require('dotenv').config();

const CMS_SECRET   = process.env.CMS_JWT_SECRET   || 'cms-super-secret-key-change-in-prod';
const CMS_EMAIL    = process.env.CMS_ADMIN_EMAIL   || 'cms@bookapnaplot.com';
const CMS_PASSWORD = process.env.CMS_ADMIN_PASSWORD || 'CmsAdmin@123';

const multer = require('multer');
const fs     = require('fs');
const path   = require('path');
const cloudinary = require('cloudinary').v2;

// Check if Cloudinary credentials are provided
const isCloudinaryConfigured = Boolean(
  (process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET) ||
  process.env.CLOUDINARY_URL
);

if (isCloudinaryConfigured) {
  if (process.env.CLOUDINARY_URL) {
    cloudinary.config();
  } else {
    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key:    process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
      secure:     true
    });
  }
  console.log('☁️ Cloudinary configured successfully for media uploads');
}

// Ensure upload directory exists (used for local storage or temporary staging for Cloudinary)
const uploadDir = path.join(__dirname, '../../frontend/uploads/properties');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase();
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'plot-' + uniqueSuffix + ext);
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB max for images and short videos
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|webp|gif|mp4|webm|mov|mkv/;
    const ext = path.extname(file.originalname).toLowerCase().replace('.', '');
    const mime = file.mimetype.toLowerCase();
    if (allowed.test(ext) || allowed.test(mime)) {
      cb(null, true);
    } else {
      cb(new Error('Only images (jpg, png, webp, gif) and video files (mp4, webm) are allowed'));
    }
  }
});

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
      INSERT INTO cms_content (key, value) VALUES
        ('hero_headline',       'Book Your Dream Plot & Build Generational Wealth'),
        ('hero_subheadline',    'Join India''s premier plot networking portal. Purchase high-yield plot shares, earn daily pair matching commissions, referral bonuses, and luxury milestone rewards.'),
        ('hero_cta_primary',    'Start Investing'),
        ('hero_cta_secondary',  'Explore Plots'),
        ('about_company_name',  'Book Apna Plot Pvt. Ltd.'),
        ('about_description',   'Book Apna Plot is a leading real estate investment and networking firm dedicated to democratizing property ownership across India. Through our automated binary referral system, we allow individuals to participate in premium plot developments with high yield potential, transparent daily income payouts, and exclusive milestone incentives.'),
        ('about_stat_members',  '12,000+'),
        ('about_stat_years',    '6+'),
        ('about_stat_paid',     '₹5 Crore+'),
        ('about_stat_cities',   '60+'),
        ('about_mission',       'Our mission is to make premium plot investment accessible, transparent, and highly rewarding for everyone through network-driven fractional ownership.'),
        ('contact_phone',       '+91 98765 43210'),
        ('contact_email',       'invest@bookapnaplot.com'),
        ('contact_address',     'Book Apna Plot Corporate Hub, Suite 402, BKC, Mumbai, Maharashtra - 400051'),
        ('contact_upi',         'bookapnaplot@upi'),
        ('contact_bank_name',   'HDFC Bank'),
        ('contact_account_no',  '50200012345678'),
        ('contact_ifsc',        'HDFC0000123'),
        ('company_tagline',     'Your Gateway to Premium Plot Ownership'),
        ('footer_copyright',    '© 2026 Book Apna Plot Pvt. Ltd. All rights reserved.'),
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

// ── GET /api/cms/verify — Verify CMS Token ────────────────────────────────────
router.get('/verify', cmsAuth, (req, res) => {
  res.json({ ok: true, email: req.cmsUser.email, role: req.cmsUser.role });
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

// ── HELPER: Format Property Row ───────────────────────────────────────────────
function formatPropertyRow(row) {
  if (!row) return null;
  let features = [];
  if (Array.isArray(row.features)) {
    features = row.features;
  } else if (typeof row.features === 'string') {
    try {
      features = JSON.parse(row.features);
    } catch {
      features = row.features.split(',').map(f => f.trim()).filter(Boolean);
    }
  }

  let images = [];
  if (Array.isArray(row.images)) {
    images = row.images;
  } else if (typeof row.images === 'string') {
    try {
      images = JSON.parse(row.images);
    } catch {
      images = row.images.split(',').map(i => i.trim()).filter(Boolean);
    }
  }

  return {
    ...row,
    price: parseFloat(row.price || 0),
    area_sqft: row.area_sqft ? parseFloat(row.area_sqft) : null,
    features: Array.isArray(features) ? features : [],
    images: Array.isArray(images) ? images : []
  };
}

// ── POST /api/cms/upload — CMS Admin: Upload Images/Videos ────────────────────
router.post('/upload', cmsAuth, (req, res) => {
  upload.array('files', 10)(req, res, async (err) => {
    if (err) {
      console.error('File upload error:', err.message);
      return res.status(400).json({ error: err.message });
    }
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No files were uploaded' });
    }

    // If Cloudinary is configured, upload to Cloudinary CDN
    if (isCloudinaryConfigured) {
      try {
        const uploadPromises = req.files.map(file => {
          return cloudinary.uploader.upload(file.path, {
            folder: 'book-apna-plot/properties',
            resource_type: 'auto', // handles both image and video
            transformation: [
              { quality: 'auto', fetch_format: 'auto' }
            ]
          }).then(result => {
            // Delete temp local staging file
            fs.unlink(file.path, () => {});
            return result.secure_url;
          });
        });

        const fileUrls = await Promise.all(uploadPromises);
        return res.json({
          message: 'Files uploaded to Cloudinary CDN successfully',
          files: fileUrls,
          provider: 'cloudinary'
        });
      } catch (cloudErr) {
        console.error('Cloudinary upload error:', cloudErr);
        // Fallback to local URLs if Cloudinary upload fails
        const fileUrls = req.files.map(f => `/uploads/properties/${f.filename}`);
        return res.json({
          message: 'Cloudinary upload had an issue; saved to local storage fallback: ' + cloudErr.message,
          files: fileUrls,
          provider: 'local_fallback'
        });
      }
    }

    // Default: Local disk storage
    const fileUrls = req.files.map(f => `/uploads/properties/${f.filename}`);
    res.json({
      message: 'Files uploaded successfully (Local storage. Configure Cloudinary credentials in .env to upload directly to Cloud CDN)',
      files: fileUrls,
      provider: 'local'
    });
  });
});

// ── GET /api/cms/properties — PUBLIC: List Properties (with search & filters) ─
router.get('/properties', async (req, res) => {
  try {
    const {
      q,
      property_type,
      status,
      min_price,
      max_price,
      min_area,
      max_area,
      featured,
      sort
    } = req.query;

    let query = 'SELECT * FROM properties WHERE 1=1';
    const params = [];

    if (status && status !== 'all') {
      params.push(status);
      query += ` AND status = $${params.length}`;
    }

    if (property_type && property_type !== 'all') {
      params.push(property_type);
      query += ` AND property_type = $${params.length}`;
    }

    if (featured === 'true' || featured === true) {
      query += ' AND is_featured = true';
    }

    if (min_price) {
      params.push(parseFloat(min_price));
      query += ` AND price >= $${params.length}`;
    }

    if (max_price) {
      params.push(parseFloat(max_price));
      query += ` AND price <= $${params.length}`;
    }

    if (min_area) {
      params.push(parseFloat(min_area));
      query += ` AND area_sqft >= $${params.length}`;
    }

    if (max_area) {
      params.push(parseFloat(max_area));
      query += ` AND area_sqft <= $${params.length}`;
    }

    if (q && q.trim()) {
      params.push(`%${q.trim()}%`);
      const idx = params.length;
      query += ` AND (title ILIKE $${idx} OR address ILIKE $${idx} OR city ILIKE $${idx} OR state ILIKE $${idx} OR description ILIKE $${idx} OR features ILIKE $${idx})`;
    }

    // Sorting
    switch (sort) {
      case 'price_asc':
        query += ' ORDER BY price ASC';
        break;
      case 'price_desc':
        query += ' ORDER BY price DESC';
        break;
      case 'area_asc':
        query += ' ORDER BY area_sqft ASC NULLS LAST';
        break;
      case 'area_desc':
        query += ' ORDER BY area_sqft DESC NULLS LAST';
        break;
      case 'latest':
      default:
        query += ' ORDER BY is_featured DESC, created_at DESC';
        break;
    }

    const result = await pool.query(query, params);
    const properties = result.rows.map(formatPropertyRow);

    res.json({
      total: properties.length,
      properties
    });
  } catch (err) {
    console.error('Error fetching properties:', err);
    res.status(500).json({ error: 'Failed to fetch properties' });
  }
});

// ── GET /api/cms/properties/:id — PUBLIC: Single Property PDP & Related Plots ──
router.get('/properties/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('SELECT * FROM properties WHERE id = $1', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Property not found' });
    }

    const property = formatPropertyRow(result.rows[0]);

    // Fetch related/similar properties
    const relatedResult = await pool.query(
      `SELECT * FROM properties 
       WHERE id != $1 AND status = 'available' 
       ORDER BY (property_type = $2) DESC, created_at DESC 
       LIMIT 3`,
      [id, property.property_type]
    );
    const related = relatedResult.rows.map(formatPropertyRow);

    res.json({ property, related });
  } catch (err) {
    console.error('Error fetching property detail:', err);
    res.status(500).json({ error: 'Failed to fetch property detail' });
  }
});

// ── POST /api/cms/properties — CMS Admin: Create Property ─────────────────────
router.post('/properties', cmsAuth, async (req, res) => {
  try {
    const {
      title,
      property_type,
      price,
      price_display,
      area_sqft,
      dimensions,
      facing,
      road_width,
      address,
      city,
      state,
      pincode,
      features,
      contact_number,
      whatsapp_number,
      images,
      video_url,
      description,
      status,
      is_featured
    } = req.body;

    if (!title || !title.trim()) {
      return res.status(400).json({ error: 'Property/Plot title is required' });
    }
    if (price === undefined || price === null || isNaN(parseFloat(price))) {
      return res.status(400).json({ error: 'A valid price/rate is required' });
    }
    if (!address || !address.trim()) {
      return res.status(400).json({ error: 'Address/Location is required' });
    }
    if (!contact_number || !contact_number.trim()) {
      return res.status(400).json({ error: 'Contact phone number is required' });
    }

    const numPrice = parseFloat(price);
    const numArea = area_sqft ? parseFloat(area_sqft) : null;

    // Formatted price display fallback
    const finalPriceDisplay = price_display?.trim() || `₹${numPrice.toLocaleString('en-IN')}`;

    // Prepare JSON arrays
    const finalFeatures = Array.isArray(features) 
      ? JSON.stringify(features) 
      : JSON.stringify(typeof features === 'string' ? features.split('\n').map(s => s.trim()).filter(Boolean) : []);

    const finalImages = Array.isArray(images)
      ? JSON.stringify(images)
      : JSON.stringify(typeof images === 'string' ? images.split('\n').map(s => s.trim()).filter(Boolean) : []);

    const insertQuery = `
      INSERT INTO properties (
        title, property_type, price, price_display, area_sqft, dimensions,
        facing, road_width, address, city, state, pincode, features,
        contact_number, whatsapp_number, images, video_url, description,
        status, is_featured, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, NOW(), NOW()
      ) RETURNING *
    `;

    const values = [
      title.trim(),
      property_type || 'Residential Plot',
      numPrice,
      finalPriceDisplay,
      numArea,
      dimensions?.trim() || null,
      facing?.trim() || null,
      road_width?.trim() || null,
      address.trim(),
      city?.trim() || null,
      state?.trim() || null,
      pincode?.trim() || null,
      finalFeatures,
      contact_number.trim(),
      whatsapp_number?.trim() || contact_number.trim(),
      finalImages,
      video_url?.trim() || null,
      description?.trim() || null,
      status || 'available',
      Boolean(is_featured)
    ];

    const result = await pool.query(insertQuery, values);
    const newProperty = formatPropertyRow(result.rows[0]);

    res.status(201).json({
      message: 'Property created successfully',
      property: newProperty
    });
  } catch (err) {
    console.error('Error creating property:', err);
    res.status(500).json({ error: 'Server error creating property: ' + err.message });
  }
});

// ── PUT /api/cms/properties/:id — CMS Admin: Update Property ──────────────────
router.put('/properties/:id', cmsAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const {
      title,
      property_type,
      price,
      price_display,
      area_sqft,
      dimensions,
      facing,
      road_width,
      address,
      city,
      state,
      pincode,
      features,
      contact_number,
      whatsapp_number,
      images,
      video_url,
      description,
      status,
      is_featured
    } = req.body;

    const existingCheck = await pool.query('SELECT id FROM properties WHERE id = $1', [id]);
    if (existingCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Property not found' });
    }

    if (!title || !title.trim()) {
      return res.status(400).json({ error: 'Property/Plot title is required' });
    }
    if (price === undefined || price === null || isNaN(parseFloat(price))) {
      return res.status(400).json({ error: 'A valid price/rate is required' });
    }
    if (!address || !address.trim()) {
      return res.status(400).json({ error: 'Address/Location is required' });
    }
    if (!contact_number || !contact_number.trim()) {
      return res.status(400).json({ error: 'Contact phone number is required' });
    }

    const numPrice = parseFloat(price);
    const numArea = area_sqft ? parseFloat(area_sqft) : null;
    const finalPriceDisplay = price_display?.trim() || `₹${numPrice.toLocaleString('en-IN')}`;

    const finalFeatures = Array.isArray(features) 
      ? JSON.stringify(features) 
      : JSON.stringify(typeof features === 'string' ? features.split('\n').map(s => s.trim()).filter(Boolean) : []);

    const finalImages = Array.isArray(images)
      ? JSON.stringify(images)
      : JSON.stringify(typeof images === 'string' ? images.split('\n').map(s => s.trim()).filter(Boolean) : []);

    const updateQuery = `
      UPDATE properties SET
        title = $1,
        property_type = $2,
        price = $3,
        price_display = $4,
        area_sqft = $5,
        dimensions = $6,
        facing = $7,
        road_width = $8,
        address = $9,
        city = $10,
        state = $11,
        pincode = $12,
        features = $13,
        contact_number = $14,
        whatsapp_number = $15,
        images = $16,
        video_url = $17,
        description = $18,
        status = $19,
        is_featured = $20,
        updated_at = NOW()
      WHERE id = $21
      RETURNING *
    `;

    const values = [
      title.trim(),
      property_type || 'Residential Plot',
      numPrice,
      finalPriceDisplay,
      numArea,
      dimensions?.trim() || null,
      facing?.trim() || null,
      road_width?.trim() || null,
      address.trim(),
      city?.trim() || null,
      state?.trim() || null,
      pincode?.trim() || null,
      finalFeatures,
      contact_number.trim(),
      whatsapp_number?.trim() || contact_number.trim(),
      finalImages,
      video_url?.trim() || null,
      description?.trim() || null,
      status || 'available',
      Boolean(is_featured),
      id
    ];

    const result = await pool.query(updateQuery, values);
    const updatedProperty = formatPropertyRow(result.rows[0]);

    res.json({
      message: 'Property updated successfully',
      property: updatedProperty
    });
  } catch (err) {
    console.error('Error updating property:', err);
    res.status(500).json({ error: 'Server error updating property: ' + err.message });
  }
});

// ── DELETE /api/cms/properties/:id — CMS Admin: Delete Property ───────────────
router.delete('/properties/:id', cmsAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('DELETE FROM properties WHERE id = $1 RETURNING id', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Property not found' });
    }
    res.json({ message: 'Property deleted successfully', id: result.rows[0].id });
  } catch (err) {
    console.error('Error deleting property:', err);
    res.status(500).json({ error: 'Server error deleting property' });
  }
});

module.exports = router;


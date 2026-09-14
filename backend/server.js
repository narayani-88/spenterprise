// Book Mera Plot - Production Server v1.1.0
const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const app = express();
app.enable('trust proxy');

// Enforce HTTPS behind reverse proxies (Railway, etc.) to prevent stripped auth headers
app.use((req, res, next) => {
  const proto = req.headers['x-forwarded-proto'];
  if (proto && proto.toLowerCase() === 'http') {
    return res.redirect(301, `https://${req.headers.host}${req.url}`);
  }
  next();
});

app.use(cors());
app.use(express.json());
app.get('/favicon.ico', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/images/logo.png'));
});
app.use('/uploads', express.static(path.join(__dirname, '../frontend/uploads')));
app.use(express.static(path.join(__dirname, '../frontend'), {
  extensions: ['html'],
  etag: false,
  maxAge: 0,
  setHeaders: (res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  }
}));

app.use('/api/auth',  require('./routes/auth'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/user',  require('./routes/users'));
app.use('/api/cms',   require('./routes/cms'));

// Note: /api/admin/run-daily-job is handled by routes/admin.js with proper auth

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

const fs = require('fs');
const pool = require('./db');
const bcrypt = require('bcryptjs');

async function autoInitDB() {
  try {
    console.log('🔄 Checking / initializing database tables...');
    const schema = fs.readFileSync(path.join(__dirname, 'scripts/schema.sql'), 'utf8');
    await pool.query(schema);

    // Auto-migration checks for existing databases
    await pool.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS source_type VARCHAR(20) DEFAULT 'REAL_USER';
      ALTER TABLE users ADD COLUMN IF NOT EXISTS plain_password VARCHAR(255);
      ALTER TABLE users ADD COLUMN IF NOT EXISTS aadhar_number VARCHAR(20);
      ALTER TABLE users ADD COLUMN IF NOT EXISTS pan_number VARCHAR(20);
      ALTER TABLE users ADD COLUMN IF NOT EXISTS age INT;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS address TEXT;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS qualification VARCHAR(100);
      ALTER TABLE users ADD COLUMN IF NOT EXISTS purpose VARCHAR(10);
      ALTER TABLE users ADD COLUMN IF NOT EXISTS bank_name VARCHAR(100);
      ALTER TABLE users ADD COLUMN IF NOT EXISTS bank_account VARCHAR(50);
      ALTER TABLE users ADD COLUMN IF NOT EXISTS bank_ifsc VARCHAR(20);
      ALTER TABLE users ADD COLUMN IF NOT EXISTS aadhar_image_url TEXT;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS pan_image_url TEXT;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS bank_proof_url TEXT;
      ALTER TABLE transactions ADD COLUMN IF NOT EXISTS attributed_to VARCHAR(20) DEFAULT 'REAL_USER';
      ALTER TABLE daily_pair_log ADD COLUMN IF NOT EXISTS attributed_to VARCHAR(20) DEFAULT 'REAL_USER';
    `).catch(err => console.log('Column auto-migration notice:', err.message));

    const cmsSchema = fs.readFileSync(path.join(__dirname, 'scripts/cms_setup.sql'), 'utf8');
    await pool.query(cmsSchema);

    const adminPassword = process.env.ADMIN_PASSWORD || process.env.INITIAL_ADMIN_PASSWORD;
    if (adminPassword) {
      const hash = bcrypt.hashSync(adminPassword, 10);
      await pool.query(`
        INSERT INTO users (
          member_id, source_type, name, email, phone, password_hash, role,
          referral_code, utr_number,
          is_active, current_rank, kyc_status
        ) VALUES (
          'BMP0000',
          'COMPANY_PLACED',
          'Book Mera Plot',
          'admin@bookmeraplot.com',
          '9800000000',
          $1,
          'admin',
          'COMP001',
          'UTR-COMP-001',
          true,
          'CGM',
          'approved'
        ) ON CONFLICT (email) DO UPDATE SET name='Book Mera Plot'
      `, [hash]);

      // Also support legacy admin accounts
      await pool.query(`
        INSERT INTO users (
          member_id, source_type, name, email, phone, password_hash, role,
          referral_code, utr_number,
          is_active, current_rank, kyc_status
        ) VALUES (
          'BAP0000',
          'COMPANY_PLACED',
          'Book Mera Plot',
          'legacy_admin@bookmeraplot.com',
          '9800000000',
          $1,
          'admin',
          'BAPADMIN001',
          'UTR-BAP-001',
          true,
          'CGM',
          'approved'
        ) ON CONFLICT (email) DO UPDATE SET name='Book Mera Plot'
      `, [hash]);
    }

    // Auto-migrate wallets constraint to include TDS_PAYABLE and NWF_POOL
    await pool.query(`
      ALTER TABLE wallets DROP CONSTRAINT IF EXISTS wallets_wallet_type_check;
      ALTER TABLE wallets ADD CONSTRAINT wallets_wallet_type_check CHECK (wallet_type IN ('USER_PAYABLE', 'COMPANY_EARNED', 'MEGA_ACCOUNT', 'TDS_PAYABLE', 'NWF_POOL'));
    `).catch(() => {});

    // Partial unique indexes required for wallet upserts (CREATE TABLE IF NOT EXISTS
    // does not add these if wallets already existed from an older schema).
    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_company_wallets_unique
        ON wallets (wallet_type) WHERE owner_id IS NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_user_wallets_unique
        ON wallets (owner_id, wallet_type) WHERE owner_id IS NOT NULL;
    `).catch(err => console.log('Wallet unique-index notice:', err.message));

    // Initialize company-level wallets without ON CONFLICT (NULL owner_id cannot
    // match UNIQUE(owner_id, wallet_type); only the partial index above can.)
    for (const walletType of ['MEGA_ACCOUNT', 'COMPANY_EARNED', 'TDS_PAYABLE', 'NWF_POOL']) {
      await pool.query(`
        INSERT INTO wallets (owner_id, wallet_type, balance)
        SELECT NULL, $1, 0
        WHERE NOT EXISTS (
          SELECT 1 FROM wallets WHERE owner_id IS NULL AND wallet_type = $1
        )
      `, [walletType]);
    }

    console.log('✅ Database tables, company wallets, and Book Mera Plot admin account initialized');
  } catch (err) {
    console.error('⚠️ DB Auto-Init Warning:', err.message);
  }
}

const PORT = process.env.PORT || 5000;
app.listen(PORT, async () => {
  console.log(`\n🚀 Book Mera Plot Portal running on port ${PORT}`);
  console.log(`📊 Admin Account: admin@bookmeraplot.com / [CONFIGURED IN ENV]\n`);

  await autoInitDB();
  scheduleDailyJob();
});

function scheduleDailyJob() {
  const now      = new Date();
  const midnight = new Date(now);
  midnight.setDate(midnight.getDate() + 1);
  midnight.setHours(0, 1, 0, 0); // 12:01 AM
  const msUntilMidnight = midnight - now;

  console.log(`⏰ Daily pair job scheduled in ${Math.round(msUntilMidnight / 3600000)} hours`);

  setTimeout(async () => {
    const { runDailyPairJob } = require('./services/incomeEngine');
    await runDailyPairJob();
    // Reschedule for next day
    setInterval(async () => {
      await runDailyPairJob();
    }, 24 * 60 * 60 * 1000);
  }, msUntilMidnight);
}


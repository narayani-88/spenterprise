const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend'), {
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
          'BAP0000',
          'COMPANY_PLACED',
          'Book Apna Plot',
          'admin@bookapnaplot.com',
          '9800000000',
          $1,
          'admin',
          'COMP001',
          'UTR-COMP-001',
          true,
          'CGM',
          'approved'
        ) ON CONFLICT (email) DO UPDATE SET name='Book Apna Plot'
      `, [hash]);

      // Also support legacy admin email login
      await pool.query(`
        INSERT INTO users (
          member_id, source_type, name, email, phone, password_hash, role,
          referral_code, utr_number,
          is_active, current_rank, kyc_status
        ) VALUES (
          'BAP0000',
          'COMPANY_PLACED',
          'Book Apna Plot',
          'admin@bookapnaplot.com',
          '9800000000',
          $1,
          'admin',
          'BAPADMIN001',
          'UTR-BAP-001',
          true,
          'CGM',
          'approved'
        ) ON CONFLICT (email) DO UPDATE SET name='Book Apna Plot'
      `, [hash]);
    }

    // Auto-migrate wallets constraint to include TDS_PAYABLE and NWF_POOL
    await pool.query(`
      ALTER TABLE wallets DROP CONSTRAINT IF EXISTS wallets_wallet_type_check;
      ALTER TABLE wallets ADD CONSTRAINT wallets_wallet_type_check CHECK (wallet_type IN ('USER_PAYABLE', 'COMPANY_EARNED', 'MEGA_ACCOUNT', 'TDS_PAYABLE', 'NWF_POOL'));
    `).catch(() => {});

    // Initialize company-level wallets (MEGA_ACCOUNT, COMPANY_EARNED, TDS_PAYABLE, NWF_POOL)
    await pool.query(`
      INSERT INTO wallets (owner_id, wallet_type, balance)
      VALUES (NULL, 'MEGA_ACCOUNT', 0)
      ON CONFLICT (owner_id, wallet_type) DO NOTHING
    `);
    await pool.query(`
      INSERT INTO wallets (owner_id, wallet_type, balance)
      VALUES (NULL, 'COMPANY_EARNED', 0)
      ON CONFLICT (owner_id, wallet_type) DO NOTHING
    `);
    await pool.query(`
      INSERT INTO wallets (owner_id, wallet_type, balance)
      VALUES (NULL, 'TDS_PAYABLE', 0)
      ON CONFLICT (owner_id, wallet_type) DO NOTHING
    `);
    await pool.query(`
      INSERT INTO wallets (owner_id, wallet_type, balance)
      VALUES (NULL, 'NWF_POOL', 0)
      ON CONFLICT (owner_id, wallet_type) DO NOTHING
    `);

    console.log('✅ Database tables, company wallets, and Book Apna Plot admin account initialized');
  } catch (err) {
    console.error('⚠️ DB Auto-Init Warning:', err.message);
  }
}

const PORT = process.env.PORT || 5000;
app.listen(PORT, async () => {
  console.log(`\n🚀 Book Apna Plot Portal running on port ${PORT}`);
  console.log(`📊 Admin Account: admin@bookapnaplot.com / [CONFIGURED IN ENV]\n`);

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


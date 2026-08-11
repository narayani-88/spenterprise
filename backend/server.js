const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend')));

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

    const cmsSchema = fs.readFileSync(path.join(__dirname, 'scripts/cms_setup.sql'), 'utf8');
    await pool.query(cmsSchema);

    const adminPassword = 'Admin@1234';
    const hash = bcrypt.hashSync(adminPassword, 10);
    await pool.query(`
      INSERT INTO users (
        member_id, name, email, phone, password_hash, role,
        referral_code, utr_number,
        is_active, current_rank, kyc_status
      ) VALUES (
        'SP0000',
        'SP Enterprise',
        'admin@spenterprise.com',
        '9800000000',
        $1,
        'admin',
        'COMP001',
        'UTR-COMP-001',
        true,
        'CGM',
        'approved'
      ) ON CONFLICT (email) DO NOTHING
    `, [hash]);
    console.log('✅ Database tables and admin account initialized');
  } catch (err) {
    console.error('⚠️ DB Auto-Init Warning:', err.message);
  }
}

const PORT = process.env.PORT || 5000;
app.listen(PORT, async () => {
  console.log(`\n🚀 MLM Dashboard running on port ${PORT}`);
  console.log(`📊 Admin Login: admin@spenterprise.com / Admin@1234\n`);

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


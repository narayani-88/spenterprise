/**
 * Seed — creates schema + company admin account ONLY.
 * All other data will be entered through the dashboard.
 * Run: node scripts/seed.js
 */
const { Pool } = require('pg');
const bcrypt   = require('bcryptjs');
const fs       = require('fs');
const path     = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const pool = new Pool({
  host:     process.env.DB_HOST     || 'localhost',
  port:     parseInt(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME     || 'mlm_dashboard',
  user:     process.env.DB_USER     || 'postgres',
  password: process.env.DB_PASSWORD || 'password',
});

async function seed() {
  const client = await pool.connect();
  try {
    console.log('🌱 Creating schema...');
    const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
    await client.query(schema);
    console.log('✅ Schema created');

    // ── COMPANY ADMIN ACCOUNT ─────────────────────────────────────────────
    const adminPassword = 'Admin@1234';
    const hash = bcrypt.hashSync(adminPassword, 10);

    await client.query(`
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

    console.log('\n✅ Done!\n');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('  Company Admin Login');
    console.log('  Member ID: SP0000');
    console.log('  Email   : admin@spenterprise.com');
    console.log('  Password: Admin@1234');
    console.log('  (You can log in with Member ID or Email)');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('\n  Start server: npm run dev');
    console.log('  Dashboard   : http://localhost:5000\n');

  } catch (err) {
    console.error('❌ Seed failed:', err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

seed();

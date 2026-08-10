/**
 * Seed — creates schema, CMS tables + company admin account ONLY.
 * Run: node scripts/seed.js
 */
const { Pool } = require('pg');
const bcrypt   = require('bcryptjs');
const fs       = require('fs');
const path     = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const pool = process.env.DATABASE_URL
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DB_SSL === 'false' ? false : { rejectUnauthorized: false },
    })
  : new Pool({
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
    console.log('✅ Main schema created');

    console.log('🌱 Setting up CMS tables...');
    const cmsSchema = fs.readFileSync(path.join(__dirname, 'cms_setup.sql'), 'utf8');
    await client.query(cmsSchema);
    console.log('✅ CMS tables created');

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

    console.log('\n✅ Seed completed successfully!\n');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('  Company Admin Login');
    console.log('  Member ID: SP0000');
    console.log('  Email   : admin@spenterprise.com');
    console.log('  Password: Admin@1234');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  } catch (err) {
    console.error('❌ Seed failed:', err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

seed();


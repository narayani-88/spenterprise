const { Pool } = require('pg');
require('dotenv').config();

const pool = process.env.DATABASE_URL
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DB_SSL === 'false' ? false : { rejectUnauthorized: false },
    })
  : new Pool({
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT) || 5432,
      database: process.env.DB_NAME || 'mlm_dashboard',
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD || 'password',
    });

pool.on('connect', () => console.log('✅ PostgreSQL connected'));
pool.on('error', (err) => console.error('❌ DB error:', err));

// Auto-migration: ensure all optional columns exist on DB (e.g. Render DB)
async function runAutoMigrations() {
  try {
    const migrations = [
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS plain_password TEXT`,
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS age TEXT`,
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS address TEXT`,
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS qualification TEXT`,
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS purpose TEXT`,
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS aadhar_number TEXT`,
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS bank_name TEXT`,
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS bank_account TEXT`,
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS bank_ifsc TEXT`
    ];
    for (const sql of migrations) {
      await pool.query(sql);
    }
    console.log('✅ Auto-migration completed: database schema verified');
  } catch (err) {
    console.error('⚠️ Auto-migration notice:', err.message);
  }
}

// Run auto-migration on start
runAutoMigrations();

module.exports = pool;


require('dotenv').config();
const { Client } = require('pg');

const client = new Client({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME || 'mlm_dashboard',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'password',
  connectionTimeoutMillis: 5000,
  query_timeout: 5000,
  statement_timeout: 5000
});

async function run() {
  try {
    console.log('Connecting directly (no SSL)...');
    await client.connect();
    console.log('Connected!');
    console.log('Running ROLLBACK...');
    await client.query('ROLLBACK');
    console.log('ROLLBACK finished!');
    const res = await client.query('SELECT 1 as test');
    console.log('Query result:', res.rows);
  } catch (e) {
    console.error('Direct connection failed:', e);
  } finally {
    await client.end();
  }
}
run();

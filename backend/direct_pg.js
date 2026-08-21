require('dotenv').config();
const { Client } = require('pg');

const client = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DB_SSL === 'false' ? false : { rejectUnauthorized: false },
  connectionTimeoutMillis: 5000,
  query_timeout: 5000,
  statement_timeout: 5000
});

async function run() {
  try {
    console.log('Connecting directly...');
    await client.connect();
    console.log('Connected directly!');
    const res = await client.query('SELECT 1 as test');
    console.log('Query result:', res.rows);
  } catch (e) {
    console.error('Direct connection failed:', e);
  } finally {
    await client.end();
  }
}
run();

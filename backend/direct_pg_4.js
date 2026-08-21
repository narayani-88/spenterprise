require('dotenv').config();
const pool = require('./db');

async function run() {
  try {
    console.log('Running simple query via db.js...');
    const res = await pool.query('SELECT 1');
    console.log('Query result:', res.rows);
  } catch (e) {
    console.error('Query failed:', e);
  } finally {
    await pool.end();
  }
}
run();

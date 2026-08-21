require('dotenv').config();
const fs = require('fs');
const pool = require('./db');

async function run() {
  try {
    console.log('Running schema...');
    const schema = fs.readFileSync('scripts/schema.sql', 'utf8');
    await pool.query(schema);
    console.log('Schema executed!');
  } catch (e) {
    console.error('Schema execution failed:', e);
  } finally {
    await pool.end();
  }
}
run();

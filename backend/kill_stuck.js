require('dotenv').config();
const pool = require('./db');
async function run() {
  try {
    const res = await pool.query(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE pid <> pg_backend_pid() AND state = 'idle in transaction'`);
    console.log('Terminated stuck transactions:', res.rowCount);
    const res2 = await pool.query(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE pid <> pg_backend_pid()`);
    console.log('Terminated all other connections:', res2.rowCount);
  } catch (e) {
    console.error(e);
  } finally {
    pool.end();
  }
}
run();

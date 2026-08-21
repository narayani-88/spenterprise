require('dotenv').config({path: './backend/.env'});
const pool = require('./backend/db');
async function test() {
  try {
    const res = await pool.query("SELECT pid, state, wait_event_type, wait_event, query FROM pg_stat_activity WHERE state != 'idle'");
    console.log(res.rows);
  } catch (e) {
    console.error(e);
  } finally {
    pool.end();
  }
}
test();

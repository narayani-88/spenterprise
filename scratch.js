require('./backend/node_modules/dotenv').config({path: './backend/.env'});
const pool = require('./backend/db');
async function test() {
  try {
    const res = await pool.query("SELECT id, member_id, name, email FROM users WHERE member_id = 'BAP0000' OR name ILIKE '%apna%'");
    console.log('Result:', res.rows);
  } catch (e) {
    console.error(e);
  } finally {
    pool.end();
  }
}
test();

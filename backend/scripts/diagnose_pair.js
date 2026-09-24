require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const pool = require('../db');

async function diagnose() {
  const client = await pool.connect();
  try {
    const today = new Date().toISOString().split('T')[0];
    console.log('=== DIAGNOSIS FOR DATE:', today, '===\n');

    // 1. Check user member counts
    const usersRes = await client.query(
      "SELECT id, name, member_id, left_member_count, right_member_count, is_active, total_pairs FROM users WHERE role='user' ORDER BY id"
    );
    console.log('--- User Member Counts ---');
    usersRes.rows.forEach(u => {
      const canPair = u.left_member_count > 0 && u.right_member_count > 0;
      console.log('  ' + u.member_id + ' (' + u.name + ') | L:' + u.left_member_count + ' R:' + u.right_member_count + ' | active:' + u.is_active + ' | can_pair:' + canPair);
    });

    // 2. Check today's daily_pair_log
    const logRes = await client.query(
      "SELECT u.member_id, d.pairs_matched, d.amount_paid, d.log_date FROM daily_pair_log d JOIN users u ON d.user_id = u.id WHERE d.log_date = $1 ORDER BY d.user_id",
      [today]
    );
    console.log('\n--- Today Pair Log Entries (' + today + ') ---');
    if (logRes.rows.length === 0) {
      console.log('  NONE — no pair log for today');
    } else {
      logRes.rows.forEach(function(r) { console.log('  ' + r.member_id + ': ' + r.pairs_matched + ' pairs, Rs.' + r.amount_paid); });
    }

    // 3. Overall pair income transactions
    const txRes = await client.query(
      "SELECT COUNT(*) AS cnt, COALESCE(SUM(net_amount),0) AS total FROM transactions WHERE income_type='pair_income'"
    );
    const pmiRes = await client.query(
      "SELECT COUNT(*) AS cnt, COALESCE(SUM(net_amount),0) AS total FROM transactions WHERE income_type='pmi_family_bonus'"
    );
    console.log('\n--- Total Transactions in DB ---');
    console.log('  Pair Income: ' + txRes.rows[0].cnt + ' txns, Rs.' + txRes.rows[0].total);
    console.log('  PMI Bonus  : ' + pmiRes.rows[0].cnt + ' txns, Rs.' + pmiRes.rows[0].total);

  } finally {
    client.release();
    pool.end();
  }
}

diagnose().catch(function(err) { console.error(err.message); process.exit(1); });

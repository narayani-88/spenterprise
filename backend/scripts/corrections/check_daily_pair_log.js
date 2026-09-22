/**
 * Check Daily Pair Log
 *
 * This script checks if daily pair income has already been generated today.
 */

const Pool = require('pg').Pool;
const pool = new Pool({
  connectionString: 'postgresql://postgres:kxllqjdGDkwnxMlzvkZaVsLIvVtdKTcp@postgres.railway.internal:5432/railway'
});

(async () => {
  const client = await pool.connect();
  try {
    console.log('📊 Daily Pair Log Check');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    const today = new Date().toISOString().split('T')[0];
    console.log(`Checking for log entries on: ${today}\n`);

    const logRes = await client.query(
      `SELECT 
         u.member_id,
         u.name,
         dpl.log_date,
         dpl.pairs_matched,
         dpl.amount_paid,
         dpl.left_pv_start,
         dpl.right_pv_start,
         dpl.pmi_triggered
       FROM daily_pair_log dpl
       JOIN users u ON dpl.user_id = u.id
       WHERE dpl.log_date = $1
       ORDER BY dpl.amount_paid DESC`,
      [today]
    );

    if (logRes.rows.length === 0) {
      console.log('❌ No daily pair log entries found for today.');
      console.log('   This means pair income has NOT been generated yet today.');
    } else {
      console.log(`✅ Found ${logRes.rows.length} daily pair log entries for today:\n`);
      console.log('Member | Pairs | Amount | PMI | Left PV | Right PV');
      console.log('─────────────────────────────────────────────────────────');
      
      let totalPairs = 0;
      let totalAmount = 0;

      for (const row of logRes.rows) {
        totalPairs += parseInt(row.pairs_matched);
        totalAmount += parseFloat(row.amount_paid);
        console.log(
          `${row.member_id.padEnd(8)} | ${String(row.pairs_matched).padStart(5)} | ₹${String(row.amount_paid).padStart(6)} | ${row.pmi_triggered ? '✅' : '❌'} | ${String(row.left_pv_start).padStart(7)} | ${String(row.right_pv_start).padStart(8)}`
        );
      }

      console.log('');
      console.log('Summary:');
      console.log(`  Total pairs matched today: ${totalPairs}`);
      console.log(`  Total amount paid today: ₹${totalAmount}`);
    }

  } catch (err) {
    console.error('❌ Error:', err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
})();

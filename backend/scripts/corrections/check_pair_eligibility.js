/**
 * Check Pair Income Eligibility
 *
 * This script checks which members are eligible for pair income
 * by checking if they have both left and right members.
 */

const Pool = require('pg').Pool;
const pool = new Pool({
  connectionString: 'postgresql://postgres:kxllqjdGDkwnxMlzvkZaVsLIvVtdKTcp@postgres.railway.internal:5432/railway'
});

(async () => {
  const client = await pool.connect();
  try {
    console.log('📊 Pair Income Eligibility Check');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    const usersRes = await client.query(
      `SELECT id, member_id, name, left_member_count, right_member_count, is_active 
       FROM users WHERE role='user' AND is_active=true
       ORDER BY left_member_count + right_member_count DESC`
    );

    console.log(`\nTotal Active Members: ${usersRes.rows.length}\n`);

    let eligibleCount = 0;
    let totalLeftCount = 0;
    let totalRightCount = 0;

    console.log('Member | Left Count | Right Count | Can Generate Pairs?');
    console.log('─────────────────────────────────────────────────────────');

    for (const user of usersRes.rows) {
      const leftCount = parseInt(user.left_member_count) || 0;
      const rightCount = parseInt(user.right_member_count) || 0;
      const canGeneratePairs = leftCount > 0 && rightCount > 0;
      
      if (canGeneratePairs) eligibleCount++;
      totalLeftCount += leftCount;
      totalRightCount += rightCount;

      console.log(
        `${user.member_id.padEnd(8)} | ${String(leftCount).padStart(11)} | ${String(rightCount).padStart(12)} | ${canGeneratePairs ? '✅ YES' : '❌ NO'}`
      );
    }

    console.log('');
    console.log('Summary:');
    console.log(`  Members eligible for pair income: ${eligibleCount}/${usersRes.rows.length}`);
    console.log(`  Total left members across all users: ${totalLeftCount}`);
    console.log(`  Total right members across all users: ${totalRightCount}`);

    if (eligibleCount === 0) {
      console.log('');
      console.log('❌ No members have both left and right members.');
      console.log('   Pair income requires balanced binary tree placement.');
      console.log('   New members need to be placed on both left and right sides.');
    }

  } catch (err) {
    console.error('❌ Error:', err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
})();

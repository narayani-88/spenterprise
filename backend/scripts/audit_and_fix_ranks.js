/**
 * AUDIT & RECALCULATE ALL RANKS AND MILESTONES
 *
 * This script:
 * 1. Updates ranks table with the official Jackpot Reward Plan details:
 *    - AM: ₹15,000 Incentive + Daman Tour (6 Direct Active Referrals)
 * 2. Re-evaluates every active user's qualification:
 *    - Direct active referral count (sponsor_id = user.id, is_active = true)
 *    - If >= 6 direct active SAs -> Promoted to AM (Area Manager)!
 *    - If downline has AMs -> Evaluates higher executive ranks (ZM, ACM, CM, etc.)
 * 3. Updates users.current_rank in the database
 * 4. Prints full audit table
 *
 * Run: node scripts/audit_and_fix_ranks.js
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const pool = require('../db');
const { recalculateRank, getAMReferralJackpotProgress } = require('../services/incomeEngine');

async function auditAndFixRanks() {
  const client = await pool.connect();
  try {
    console.log('═══════════════════════════════════════════════════════════════════');
    console.log('🏆 AUDITING & RECALCULATING ALL RANKS & MILESTONES');
    console.log('═══════════════════════════════════════════════════════════════════\n');

    await client.query('BEGIN');

    // Step 1: Ensure ranks table has official rewards from Jackpot Reward Plan
    console.log('📋 Step 1: Syncing official Jackpot Reward Plan to ranks table...');
    await client.query(`
      UPDATE ranks SET
        reward_title = '₹15,000 Incentive + Daman Tour',
        reward_value = '₹15,000 + Tour'
      WHERE code = 'AM'
    `);
    console.log('   ✓ AM rank reward set to: ₹15,000 Incentive + Daman Tour');

    // Step 2: Recalculate rank for every active user
    console.log('\n🔍 Step 2: Evaluating all users for rank promotion...');
    const usersRes = await client.query(`
      SELECT u.id, u.member_id, u.name, u.current_rank, u.is_active,
             (SELECT COUNT(*) FROM users WHERE sponsor_id = u.id AND is_active = true) AS direct_active_count,
             (SELECT COUNT(*) FROM users WHERE sponsor_id = u.id) AS total_direct_count
      FROM users u
      WHERE u.role = 'user'
      ORDER BY u.id ASC
    `);

    const results = [];
    let promotedCount = 0;

    for (const u of usersRes.rows) {
      const oldRank = u.current_rank || 'SA';
      const rankResult = await recalculateRank(client, u.id);

      // Fetch newly updated rank
      const updatedRes = await client.query('SELECT current_rank FROM users WHERE id=$1', [u.id]);
      const newRank = updatedRes.rows[0]?.current_rank || 'SA';

      if (oldRank !== newRank) promotedCount++;

      const jackpot = await getAMReferralJackpotProgress(client, u.id);

      results.push({
        id: u.id,
        memberId: u.member_id,
        name: u.name,
        directActive: parseInt(u.direct_active_count),
        totalDirect: parseInt(u.total_direct_count),
        oldRank,
        newRank,
        promoted: oldRank !== newRank,
        level1Jackpot: `${jackpot.level1.count}/6 AMs (${jackpot.level1.achieved ? '✅' : '⏳'})`,
        level2Jackpot: `${jackpot.level2.count}/36 AMs (${jackpot.level2.achieved ? '✅' : '⏳'})`,
        status: u.is_active ? 'Active' : 'Inactive'
      });
    }

    await client.query('COMMIT');

    console.log('\n📊 RANK AUDIT RESULTS:');
    console.table(results.map(r => ({
      'Member ID': r.memberId,
      'Name': r.name,
      'Direct Active': r.directActive,
      'Rank': r.newRank + (r.promoted ? ' 🚀 PROMOTED' : ''),
      'L1 Jackpot (6 AM)': r.level1Jackpot,
      'L2 Jackpot (36 AM)': r.level2Jackpot,
      'Status': r.status
    })));

    console.log('\n═══════════════════════════════════════════════════════════════════');
    console.log(`✅ Rank evaluation complete! ${promotedCount} members updated.`);
    console.log('═══════════════════════════════════════════════════════════════════\n');

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Rank audit failed:', err.message);
    throw err;
  } finally {
    client.release();
    pool.end();
  }
}

auditAndFixRanks().catch(err => {
  console.error(err);
  process.exit(1);
});

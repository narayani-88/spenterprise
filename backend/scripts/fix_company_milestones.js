/**
 * Fix Company Account Milestone & Ranking Eligibility
 *
 * The company account (BAP0000 / admin / COMPANY_PLACED) is NOT eligible
 * to participate in milestones and ranking (ranks are strictly for sales associates).
 *
 * This script:
 * 1. Removes any erroneous milestone_commission, jackpot_reward, or rank_reward
 *    transactions credited to company/admin accounts.
 * 2. Cleans up associated mega_ledger entries.
 * 3. Resets am_incentive_paid, milestone_triggered, and current_rank on company accounts.
 * 4. Runs reconcileFinances to restore MEGA_ACCOUNT and deduct from COMPANY_EARNED.
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const pool = require('../db');
const { reconcileFinances } = require('./reconcile_all_finances');
const { recomputeMemberCounts } = require('../services/incomeEngine');

async function fixCompanyMilestones(clientOrPool) {
  const isPool = !!clientOrPool.connect;
  const client = isPool ? await clientOrPool.connect() : clientOrPool;
  try {
    if (isPool) await client.query('BEGIN');

    // 1. Identify any milestone/rank transactions belonging to company/admin accounts
    const badTxRes = await client.query(`
      SELECT t.id, t.user_id, t.income_type, t.amount, t.net_amount, t.description,
             u.member_id, u.name, u.role, u.source_type
      FROM transactions t
      JOIN users u ON t.user_id = u.id
      WHERE (u.role = 'admin' OR u.source_type = 'COMPANY_PLACED' OR UPPER(u.member_id) IN ('BAP0000', 'BMP0000'))
        AND t.income_type IN ('milestone_commission', 'jackpot_reward', 'rank_reward')
    `);

    if (badTxRes.rows.length > 0) {
      console.log(`⚠️ Found ${badTxRes.rows.length} invalid company milestone transaction(s) to remove:`);
      for (const tx of badTxRes.rows) {
        console.log(`   - ID ${tx.id}: ${tx.member_id} (${tx.name}) - ₹${tx.amount} (${tx.description})`);
        
        // Delete mega_ledger entries matching this transaction
        await client.query(`
          DELETE FROM mega_ledger 
          WHERE related_user_id = $1 
            AND category IN ('milestone_commission', 'jackpot_reward', 'rank_reward')
        `, [tx.user_id]);

        // Delete the bad transaction
        await client.query(`DELETE FROM transactions WHERE id = $1`, [tx.id]);
      }
    } else {
      console.log('✓ No invalid company milestone transactions found.');
    }

    // 2. Reset rank & milestone flags on company accounts (ranking is for sales associates only)
    await client.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS am_incentive_paid BOOLEAN DEFAULT false').catch(() => {});
    await client.query(`
      UPDATE users
      SET current_rank = NULL,
          am_incentive_paid = false,
          milestone_triggered = false
      WHERE role = 'admin' 
         OR source_type = 'COMPANY_PLACED' 
         OR UPPER(member_id) IN ('BAP0000', 'BMP0000')
    `);

    // 3. Resynchronize member counts and available carry-forward PV (deducting already paid pairs)
    await recomputeMemberCounts(client);

    if (isPool) await client.query('COMMIT');

    // 3. Reconcile finances so MEGA_ACCOUNT and COMPANY_EARNED balances match transactions exactly
    await reconcileFinances(clientOrPool, false);

    console.log('✅ Company milestone cleanup & financial reconciliation completed.');
    return { cleanedCount: badTxRes.rows.length };
  } catch (err) {
    if (isPool) await client.query('ROLLBACK').catch(() => {});
    console.error('❌ Error during fixCompanyMilestones:', err.message);
    throw err;
  } finally {
    if (isPool) client.release();
  }
}

if (require.main === module) {
  fixCompanyMilestones(pool)
    .then(() => {
      console.log('Done!');
      process.exit(0);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

module.exports = { fixCompanyMilestones };

/**
 * Script to fix referral income and wallet balances for all associates.
 * 
 * Ensures:
 * 1. Any associate whose referral code was used receives the earned referral income in their wallet_balance & USER_PAYABLE wallet.
 * 2. Active associates with referrals/pairs are marked as REAL_USER (not COMPANY_PLACED dummy accounts).
 * 3. Company Earned Account and Mega Account are accurately reconciled.
 * 4. Ranks (such as Area Manager) are updated based on direct active referrals.
 * 
 * Run: node backend/scripts/fix_referral_wallets.js
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const pool = require('../db');
const { recalculateRank, getOrCreateWallet } = require('../services/incomeEngine');

async function fixReferralWallets() {
  const client = await pool.connect();
  try {
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('🔄  FIXING ASSOCIATE REFERRAL INCOME & WALLET BALANCES');
    console.log('═══════════════════════════════════════════════════════════════\n');

    await client.query('BEGIN');

    // 1. Fetch all non-admin users
    const usersRes = await client.query(`
      SELECT id, member_id, name, source_type, role, wallet_balance, is_active
      FROM users
      WHERE role = 'user'
      ORDER BY id ASC
    `);

    console.log(`Found ${usersRes.rows.length} members. Checking earnings...\n`);

    let updatedUsers = 0;

    for (const u of usersRes.rows) {
      // Total credited earnings
      const earnRes = await client.query(`
        SELECT 
          COALESCE(SUM(CASE WHEN income_type = 'referral_income' THEN net_amount ELSE 0 END), 0) AS referral_earned,
          COALESCE(SUM(CASE WHEN income_type = 'pair_income' THEN net_amount ELSE 0 END), 0) AS pair_earned,
          COALESCE(SUM(CASE WHEN income_type = 'pmi_family_bonus' THEN net_amount ELSE 0 END), 0) AS pmi_earned,
          COALESCE(SUM(CASE WHEN income_type IN ('milestone_commission', 'non_working_income') THEN net_amount ELSE 0 END), 0) AS milestone_earned,
          COALESCE(SUM(net_amount), 0) AS total_earned
        FROM transactions
        WHERE user_id = $1
          AND status = 'credited'
          AND income_type IN ('pair_income', 'referral_income', 'pmi_family_bonus', 'milestone_commission', 'non_working_income')
      `, [u.id]);

      const earned = parseFloat(earnRes.rows[0].total_earned || 0);

      // Total approved withdrawals
      const withRes = await client.query(`
        SELECT COALESCE(SUM(requested_amount), 0) AS total_withdrawn
        FROM withdrawal_requests
        WHERE user_id = $1 AND status = 'approved'
      `, [u.id]);
      const withdrawn = parseFloat(withRes.rows[0].total_withdrawn || 0);

      const correctBalance = Math.max(0, parseFloat((earned - withdrawn).toFixed(2)));
      const currentBalance = parseFloat(u.wallet_balance || 0);

      const refEarned = parseFloat(earnRes.rows[0].referral_earned);
      const pairEarned = parseFloat(earnRes.rows[0].pair_earned);

      // Check if user has referrals or earned commission -> should be REAL_USER
      const directRefs = await client.query(`SELECT COUNT(*) AS count FROM users WHERE sponsor_id = $1`, [u.id]);
      const refCount = parseInt(directRefs.rows[0].count);

      const shouldBeRealUser = refCount > 0 || earned > 0;
      const needsSourceUpdate = shouldBeRealUser && u.source_type === 'COMPANY_PLACED';

      if (currentBalance !== correctBalance || needsSourceUpdate) {
        console.log(`👤 Member ${u.member_id} (${u.name}):`);
        console.log(`   - Current Wallet Balance : ₹${currentBalance}`);
        console.log(`   - Total Earned (Ref: ₹${refEarned}, Pair: ₹${pairEarned}) : ₹${earned}`);
        console.log(`   - Correct Wallet Balance : ₹${correctBalance}`);

        // Update user wallet_balance and source_type
        if (needsSourceUpdate) {
          console.log(`   - Changing source_type from 'COMPANY_PLACED' -> 'REAL_USER'`);
          await client.query(`
            UPDATE users 
            SET wallet_balance = $1, source_type = 'REAL_USER', updated_at = NOW() 
            WHERE id = $2
          `, [correctBalance, u.id]);
        } else {
          await client.query(`
            UPDATE users 
            SET wallet_balance = $1, updated_at = NOW() 
            WHERE id = $2
          `, [correctBalance, u.id]);
        }

        // Update USER_PAYABLE wallet
        const userWallet = await getOrCreateWallet(client, u.id, 'USER_PAYABLE');
        await client.query(`
          UPDATE wallets SET balance = $1, updated_at = NOW() WHERE id = $2
        `, [correctBalance, userWallet.id]);

        // Mark their transactions as REAL_USER
        await client.query(`
          UPDATE transactions SET attributed_to = 'REAL_USER' WHERE user_id = $1
        `, [u.id]);

        updatedUsers++;
        console.log(`   ✅ Updated!\n`);
      }

      // Check and update rank for AM qualification (6 direct active referrals)
      await recalculateRank(client, u.id);
    }

    // 2. Reconcile Company-level Wallets
    // A. COMPANY_EARNED: Genuine company profits (Admin user earnings only)
    const adminProfitRes = await client.query(`
      SELECT COALESCE(SUM(t.net_amount), 0) AS admin_profit
      FROM transactions t
      JOIN users u ON t.user_id = u.id
      WHERE u.role = 'admin'
        AND t.status = 'credited'
        AND t.income_type IN ('pair_income', 'referral_income', 'pmi_family_bonus', 'non_working_income')
    `);
    const companyEarnedBalance = parseFloat(adminProfitRes.rows[0].admin_profit || 0);

    const companyWallet = await getOrCreateWallet(client, null, 'COMPANY_EARNED');
    await client.query(`UPDATE wallets SET balance = $1, updated_at = NOW() WHERE id = $2`, [companyEarnedBalance, companyWallet.id]);

    // B. Total Deposits
    const depRes = await client.query(`SELECT COALESCE(SUM(total_deposited), 0) AS total FROM users WHERE role = 'user'`);
    const totalDeposits = parseFloat(depRes.rows[0].total || 0);

    // C. Total real user balances
    const userBalRes = await client.query(`SELECT COALESCE(SUM(wallet_balance), 0) AS total FROM users WHERE role = 'user'`);
    const totalUserBalances = parseFloat(userBalRes.rows[0].total || 0);

    // D. MEGA_ACCOUNT = Deposits - Total Distributed to Users - Total Company Earned
    const megaBalance = Math.max(0, parseFloat((totalDeposits - totalUserBalances - companyEarnedBalance).toFixed(2)));
    const megaWallet = await getOrCreateWallet(client, null, 'MEGA_ACCOUNT');
    await client.query(`UPDATE wallets SET balance = $1, updated_at = NOW() WHERE id = $2`, [megaBalance, megaWallet.id]);

    await client.query('COMMIT');

    console.log('═══════════════════════════════════════════════════════════════');
    console.log('🎉 RECONCILIATION & WALLET FIX COMPLETE!');
    console.log(`   Updated Associates         : ${updatedUsers}`);
    console.log(`   Total Deposits             : ₹${totalDeposits.toLocaleString('en-IN')}`);
    console.log(`   Total Associate Wallets    : ₹${totalUserBalances.toLocaleString('en-IN')}`);
    console.log(`   Company Earned Account     : ₹${companyEarnedBalance.toLocaleString('en-IN')}`);
    console.log(`   MEGA ACCOUNT (Treasury)    : ₹${megaBalance.toLocaleString('en-IN')}`);
    console.log('═══════════════════════════════════════════════════════════════\n');

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Error fixing referral wallets:', err.message);
    throw err;
  } finally {
    client.release();
    pool.end();
  }
}

fixReferralWallets().catch(err => {
  console.error(err);
  process.exit(1);
});

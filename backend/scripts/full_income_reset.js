/**
 * FULL INCOME RESET & CORRECT REDISTRIBUTION
 *
 * This script:
 * 1. Wipes ALL pair income, PMI, and referral income transactions
 * 2. Recomputes member counts from the tree
 * 3. Re-runs pair matching (income goes to each user's OWN wallet)
 * 4. Re-runs PMI cascade (20% goes up sponsor chain; stops at admin)
 * 5. Re-runs referral income (goes to whoever's referral code was used)
 * 6. Reconciles company-level wallets (MEGA, COMPANY_EARNED)
 *
 * Run: node scripts/full_income_reset.js
 *
 * Business Rules Applied:
 * - Pair income   → credited to the MATCHING USER's wallet (every associate, not company)
 * - PMI bonus     → 20% cascades UP the sponsor chain; admin gets it if they're the sponsor
 * - Referral      → credited to whoever's referral_code the new member used
 * - If admin/company is the sponsor → their share goes to COMPANY_EARNED
 * - COMPANY_EARNED = only admin node's earned income
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const pool = require('../db');
const { recomputeMemberCounts, runDailyPairForUser, triggerPMIChain, creditIncome, getOrCreateWallet } = require('../services/incomeEngine');

const REFERRAL_INCOME = 2000;

async function fullReset() {
  const client = await pool.connect();
  try {
    console.log('═══════════════════════════════════════════════════════════════════');
    console.log('🔄  FULL INCOME RESET & CORRECT REDISTRIBUTION');
    console.log('═══════════════════════════════════════════════════════════════════\n');

    await client.query('BEGIN');

    // ── Step 1: Wipe old income transactions ─────────────────────────────────
    console.log('🧹 Step 1: Wiping old pair, PMI, and referral income...');
    const del = await client.query(`
      DELETE FROM transactions
      WHERE income_type IN ('pair_income', 'pmi_family_bonus', 'referral_income', 'milestone_commission', 'non_working_income')
      RETURNING id
    `);
    console.log(`   ✓ Deleted ${del.rowCount} old income transactions`);

    // Wipe daily pair log
    const delLog = await client.query('DELETE FROM daily_pair_log RETURNING id');
    console.log(`   ✓ Deleted ${delLog.rowCount} daily pair log entries`);

    // Wipe mega ledger income entries
    const delLedger = await client.query(`
      DELETE FROM mega_ledger
      WHERE category IN ('pair_income', 'pmi_family_bonus', 'referral_income', 'pmi_company_margin', 'milestone_commission', 'non_working_income', 'reconciliation')
      RETURNING id
    `);
    console.log(`   ✓ Deleted ${delLedger.rowCount} mega ledger entries`);

    // Reset user wallets, pair counts, milestone flags
    await client.query(`
      UPDATE users
      SET wallet_balance = 0,
          pending_balance = 0,
          total_pairs = 0,
          milestone_triggered = false,
          updated_at = NOW()
      WHERE role = 'user'
    `);
    console.log('   ✓ Reset all user wallets and pair counts to 0');

    // Reset USER_PAYABLE wallets
    await client.query(`
      UPDATE wallets SET balance = 0, updated_at = NOW()
      WHERE owner_id IS NOT NULL
        AND wallet_type = 'USER_PAYABLE'
    `);
    console.log('   ✓ Reset all USER_PAYABLE wallet balances to 0');

    // Reset COMPANY_EARNED
    await client.query(`
      UPDATE wallets SET balance = 0, updated_at = NOW()
      WHERE owner_id IS NULL AND wallet_type = 'COMPANY_EARNED'
    `);
    console.log('   ✓ Reset COMPANY_EARNED to 0');

    // ── Step 2: Recompute member counts ──────────────────────────────────────
    console.log('\n🌲 Step 2: Recomputing subtree member counts from tree...');
    await recomputeMemberCounts(client);
    console.log('   ✓ Member counts recomputed');

    // ── Step 3: Re-run referral income for all activations ───────────────────
    console.log('\n💰 Step 3: Re-crediting referral income...');
    const activatedUsers = await client.query(`
      SELECT u.id, u.name, u.sponsor_id, u.is_active
      FROM users u
      WHERE u.role = 'user'
        AND u.total_deposited >= 12500
        AND u.sponsor_id IS NOT NULL
      ORDER BY u.id ASC
    `);

    let referralCount = 0;
    for (const u of activatedUsers.rows) {
      const desc = `Referral income: ${u.name} joined using your referral code`;
      await creditIncome(client, u.sponsor_id, 'referral_income', REFERRAL_INCOME, desc, u.id);
      referralCount++;
    }
    console.log(`   ✓ Credited referral income for ${referralCount} activated members`);

    // ── Step 4: Re-run pair matching (one day per unique activation date) ────
    console.log('\n🤝 Step 4: Re-running pair matching for all active users...');
    const logDate = new Date().toISOString().split('T')[0];
    const activeUsers = await client.query(`
      SELECT id FROM users WHERE role = 'user' AND is_active = true ORDER BY id ASC
    `);

    const usersWithPairIncome = [];
    let pairSuccessCount = 0;
    let pairErrorCount = 0;

    for (const row of activeUsers.rows) {
      try {
        await client.query('SAVEPOINT sp_pair');
        const pairIncome = await runDailyPairForUser(client, row.id, logDate);
        await client.query('RELEASE SAVEPOINT sp_pair');
        if (pairIncome > 0) usersWithPairIncome.push({ userId: row.id, pairIncome });
        pairSuccessCount++;
      } catch (e) {
        await client.query('ROLLBACK TO SAVEPOINT sp_pair');
        await client.query('RELEASE SAVEPOINT sp_pair');
        console.error(`   ⚠️ Pair skipped user ${row.id}: ${e.message}`);
        pairErrorCount++;
      }
    }
    console.log(`   ✓ Pair matching done: ${pairSuccessCount} users processed (${pairErrorCount} errors)`);
    console.log(`   ✓ ${usersWithPairIncome.length} users earned pair income`);

    // ── Step 5: PMI cascade for pair earners ─────────────────────────────────
    console.log('\n📈 Step 5: Running PMI cascade for pair income earners...');
    let pmiCount = 0;
    for (const { userId, pairIncome } of usersWithPairIncome) {
      try {
        await client.query('SAVEPOINT sp_pmi');
        const userRes = await client.query('SELECT id, name, sponsor_id FROM users WHERE id=$1', [userId]);
        const user = userRes.rows[0];
        if (user && user.sponsor_id) {
          await triggerPMIChain(client, userId, user.name, pairIncome, user.sponsor_id);
          pmiCount++;
        }
        await client.query('RELEASE SAVEPOINT sp_pmi');
      } catch (e) {
        await client.query('ROLLBACK TO SAVEPOINT sp_pmi');
        await client.query('RELEASE SAVEPOINT sp_pmi');
        console.error(`   ⚠️ PMI skipped user ${userId}: ${e.message}`);
      }
    }
    console.log(`   ✓ PMI cascade triggered for ${pmiCount} users`);

    // ── Step 6: Reconcile company-level wallets ───────────────────────────────
    console.log('\n🏛️ Step 6: Reconciling company-level wallets...');

    // COMPANY_EARNED = sum of all admin income transactions
    const adminEarnedRes = await client.query(`
      SELECT COALESCE(SUM(net_amount), 0) AS total
      FROM transactions t
      JOIN users u ON t.user_id = u.id
      WHERE u.role = 'admin'
        AND t.status = 'credited'
        AND t.income_type IN ('pair_income', 'referral_income', 'pmi_family_bonus')
    `);
    const companyEarned = parseFloat(adminEarnedRes.rows[0].total || 0);
    await client.query(`
      UPDATE wallets SET balance = $1, updated_at = NOW()
      WHERE owner_id IS NULL AND wallet_type = 'COMPANY_EARNED'
    `, [companyEarned]);
    console.log(`   ✓ COMPANY_EARNED set to ₹${companyEarned.toLocaleString('en-IN')}`);

    // Total user wallets
    const userWalletRes = await client.query(`
      SELECT COALESCE(SUM(wallet_balance), 0) AS total FROM users WHERE role = 'user'
    `);
    const totalUserWallets = parseFloat(userWalletRes.rows[0].total || 0);

    // Total deposits
    const depRes = await client.query(`
      SELECT COALESCE(SUM(total_deposited), 0) AS total FROM users WHERE role = 'user'
    `);
    const totalDeposits = parseFloat(depRes.rows[0].total || 0);

    // MEGA_ACCOUNT = Deposits - User Wallets - Company Earned
    const megaBalance = Math.max(0, parseFloat((totalDeposits - totalUserWallets - companyEarned).toFixed(2)));
    await client.query(`
      UPDATE wallets SET balance = $1, updated_at = NOW()
      WHERE owner_id IS NULL AND wallet_type = 'MEGA_ACCOUNT'
    `, [megaBalance]);
    console.log(`   ✓ MEGA_ACCOUNT set to ₹${megaBalance.toLocaleString('en-IN')}`);
    console.log(`   ✓ Total User Wallets: ₹${totalUserWallets.toLocaleString('en-IN')}`);
    console.log(`   ✓ Total Deposits: ₹${totalDeposits.toLocaleString('en-IN')}`);

    await client.query('COMMIT');

    console.log('\n═══════════════════════════════════════════════════════════════════');
    console.log('🎉 FULL INCOME RESET & REDISTRIBUTION COMPLETE!');
    console.log('═══════════════════════════════════════════════════════════════════');
    console.log(`   Referral Income Credited : ${referralCount} members`);
    console.log(`   Pair Income Credited     : ${usersWithPairIncome.length} members`);
    console.log(`   PMI Cascades Triggered   : ${pmiCount} members`);
    console.log(`   COMPANY_EARNED           : ₹${companyEarned.toLocaleString('en-IN')}`);
    console.log(`   Total User Wallets       : ₹${totalUserWallets.toLocaleString('en-IN')}`);
    console.log(`   MEGA_ACCOUNT (Treasury)  : ₹${megaBalance.toLocaleString('en-IN')}`);
    console.log('\n✅ All associates now have correct wallet balances.');
    console.log('✅ Referral income goes to the person whose code was used.');
    console.log('✅ PMI flows up the real sponsor chain.');
    console.log('✅ Company only earns when Admin is the direct sponsor or referrer.\n');

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Reset failed:', err.message);
    console.error(err.stack);
    throw err;
  } finally {
    client.release();
    pool.end();
  }
}

fullReset().catch(err => {
  console.error(err);
  process.exit(1);
});

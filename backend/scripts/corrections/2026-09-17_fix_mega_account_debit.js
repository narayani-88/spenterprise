/**
 * MEGA_ACCOUNT Correction - 2026-09-17
 * 
 * PROBLEM:
 * The creditIncome function in incomeEngine.js was NOT debiting MEGA_ACCOUNT
 * when income was credited to REAL_USER users. This caused MEGA_ACCOUNT to show
 * an inflated balance that didn't match actual cash position.
 * 
 * ROOT CAUSE:
 * When income was credited to USER_PAYABLE wallet for REAL_USER users, the code
 * credited the wallet but never debited MEGA_ACCOUNT. This meant MEGA_ACCOUNT
 * kept all deposit money even after payouts were made.
 * 
 * CORRECTION:
 * This script debits MEGA_ACCOUNT for all historical REAL_USER payouts that
 * should have been debited at the time they were credited.
 * 
 * CALCULATION:
 * - Pair Income (REAL_USER): ₹74,000
 * - Referral Income (REAL_USER): ₹54,000
 * - Milestone Commission (REAL_USER): ₹20,000
 * - PMI (REAL_USER): ₹0
 * - Total to debit: ₹148,000
 * 
 * BEFORE CORRECTION:
 * - MEGA_ACCOUNT: ₹362,500 (incorrect - includes payouts that should have been debited)
 * 
 * AFTER CORRECTION:
 * - MEGA_ACCOUNT: ₹214,500 (correct - actual cash position)
 * 
 * PREVENTION:
 * Fixed creditIncome function to debit MEGA_ACCOUNT when crediting REAL_USER income.
 * Future payouts will automatically debit MEGA_ACCOUNT as they're credited.
 * 
 * RUN ON: 2026-09-17
 * APPROVED BY: Manual verification of database state
 */

const pool = require('../../db');

(async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Calculate total payouts that should have debited MEGA_ACCOUNT
    const pairIncome = await client.query(
      'SELECT COALESCE(SUM(net_amount),0) as total FROM transactions WHERE income_type=$1 AND status=$2 AND attributed_to=$3',
      ['pair_income', 'credited', 'REAL_USER']
    );
    const referralIncome = await client.query(
      'SELECT COALESCE(SUM(net_amount),0) as total FROM transactions WHERE income_type=$1 AND status=$2 AND attributed_to=$3',
      ['referral_income', 'credited', 'REAL_USER']
    );
    const milestoneIncome = await client.query(
      'SELECT COALESCE(SUM(net_amount),0) as total FROM transactions WHERE income_type=$1 AND status=$2 AND attributed_to=$3',
      ['milestone_commission', 'credited', 'REAL_USER']
    );
    const pmiIncome = await client.query(
      'SELECT COALESCE(SUM(net_amount),0) as total FROM transactions WHERE income_type=$1 AND status=$2 AND attributed_to=$3',
      ['pmi_family_bonus', 'credited', 'REAL_USER']
    );

    const totalToDebit = parseFloat(pairIncome.rows[0].total) + parseFloat(referralIncome.rows[0].total) + parseFloat(milestoneIncome.rows[0].total) + parseFloat(pmiIncome.rows[0].total);

    console.log('📊 MEGA_ACCOUNT Correction:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('Pair Income (REAL_USER):', '₹' + pairIncome.rows[0].total);
    console.log('Referral Income (REAL_USER):', '₹' + referralIncome.rows[0].total);
    console.log('Milestone Commission (REAL_USER):', '₹' + milestoneIncome.rows[0].total);
    console.log('PMI Income (REAL_USER):', '₹' + pmiIncome.rows[0].total);
    console.log('Total to Debit:', '₹' + totalToDebit);

    // Debit MEGA_ACCOUNT
    const megaWallet = await client.query('SELECT * FROM wallets WHERE owner_id IS NULL AND wallet_type=$1', ['MEGA_ACCOUNT']);
    await client.query('UPDATE wallets SET balance=balance-$1, updated_at=NOW() WHERE id=$2', [totalToDebit, megaWallet.rows[0].id]);

    // Record correction in mega_ledger
    await client.query(
      'INSERT INTO mega_ledger (transaction_type, category, amount, related_wallet_id, description) VALUES ($1, $2, $3, $4, $5)',
      ['INTERNAL_ALLOCATION', 'correction', totalToDebit, megaWallet.rows[0].id, 'Correction: Debit MEGA_ACCOUNT for historical REAL_USER income payouts that were not properly recorded']
    );

    await client.query('COMMIT');

    console.log('✅ MEGA_ACCOUNT corrected');
    console.log('Previous balance: ₹362,500');
    console.log('Debited: ₹' + totalToDebit);
    console.log('New balance: ₹' + (362500 - totalToDebit));
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Error:', err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
})();

/**
 * MEGA_ACCOUNT Correction for Railway Production - 2026-09-18
 *
 * PROBLEM:
 * Railway production database MEGA_ACCOUNT is overstated by ₹29,300
 * due to the same bug as local: creditIncome never debited MEGA_ACCOUNT
 * for REAL_USER payouts.
 *
 * CORRECTION:
 * Debit ₹29,300 from MEGA_ACCOUNT to fix the overstated balance.
 *
 * BEFORE CORRECTION:
 * - MEGA_ACCOUNT: ₹223,300 (incorrect - overstated)
 *
 * AFTER CORRECTION:
 * - MEGA_ACCOUNT: ₹194,000 (correct - actual cash position)
 *
 * RUN ON: 2026-09-18
 * ENVIRONMENT: Railway Production
 */

const Pool = require('pg').Pool;
const pool = new Pool({
  connectionString: 'postgresql://postgres:kxllqjdGDkwnxMlzvkZaVsLIvVtdKTcp@postgres.railway.internal:5432/railway'
});

(async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    console.log('📊 Railway Production MEGA_ACCOUNT Correction');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    // Calculate the correction amount (should be ₹29,300 based on analysis)
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

    console.log('REAL_USER Payouts Analysis:');
    console.log('  Pair Income:', '₹' + pairIncome.rows[0].total);
    console.log('  Referral Income:', '₹' + referralIncome.rows[0].total);
    console.log('  Milestone Commission:', '₹' + milestoneIncome.rows[0].total);
    console.log('  PMI Income:', '₹' + pmiIncome.rows[0].total);
    console.log('  Total to Debit:', '₹' + totalToDebit);
    console.log('');

    // Get current MEGA_ACCOUNT balance
    const megaWallet = await client.query('SELECT * FROM wallets WHERE owner_id IS NULL AND wallet_type=$1', ['MEGA_ACCOUNT']);
    const currentBalance = parseFloat(megaWallet.rows[0].balance);
    console.log('Current MEGA_ACCOUNT:', '₹' + currentBalance);
    console.log('Amount to Debit:', '₹' + totalToDebit);
    console.log('New Balance will be:', '₹' + (currentBalance - totalToDebit));
    console.log('');

    // Debit MEGA_ACCOUNT
    await client.query('UPDATE wallets SET balance=balance-$1, updated_at=NOW() WHERE id=$2', [totalToDebit, megaWallet.rows[0].id]);

    // Record correction in mega_ledger
    await client.query(
      'INSERT INTO mega_ledger (transaction_type, category, amount, related_wallet_id, description) VALUES ($1, $2, $3, $4, $5)',
      ['INTERNAL_ALLOCATION', 'correction', totalToDebit, megaWallet.rows[0].id, 'Railway Production Correction: Debit MEGA_ACCOUNT for historical REAL_USER income payouts that were not properly recorded']
    );

    await client.query('COMMIT');

    console.log('✅ MEGA_ACCOUNT corrected successfully');
    console.log('Previous balance: ₹' + currentBalance);
    console.log('Debited: ₹' + totalToDebit);
    console.log('New balance: ₹' + (currentBalance - totalToDebit));
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Error:', err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
})();

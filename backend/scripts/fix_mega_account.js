const pool = require('../db');

(async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Calculate total payouts that should have debited MEGA_ACCOUNT
    const pairIncome = await client.query('SELECT COALESCE(SUM(net_amount),0) as total FROM transactions WHERE income_type=$1 AND status=$2 AND attributed_to=$3', ['pair_income', 'credited', 'REAL_USER']);
    const referralIncome = await client.query('SELECT COALESCE(SUM(net_amount),0) as total FROM transactions WHERE income_type=$1 AND status=$2 AND attributed_to=$3', ['referral_income', 'credited', 'REAL_USER']);
    const milestoneIncome = await client.query('SELECT COALESCE(SUM(net_amount),0) as total FROM transactions WHERE income_type=$1 AND status=$2 AND attributed_to=$3', ['milestone_commission', 'credited', 'REAL_USER']);
    const pmiIncome = await client.query('SELECT COALESCE(SUM(net_amount),0) as total FROM transactions WHERE income_type=$1 AND status=$2 AND attributed_to=$3', ['pmi_family_bonus', 'credited', 'REAL_USER']);

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

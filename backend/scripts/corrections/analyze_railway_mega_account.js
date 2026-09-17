/**
 * Analyze Railway Production Database for MEGA_ACCOUNT Correction
 *
 * This script analyzes the Railway production database to calculate the correct
 * MEGA_ACCOUNT correction amount before applying it.
 */

const Pool = require('pg').Pool;
const pool = new Pool({
  connectionString: 'postgresql://postgres:kxllqjdGDkwnxMlzvkZaVsLIvVtdKTcp@postgres.railway.internal:5432/railway'
});

(async () => {
  const client = await pool.connect();
  try {
    console.log('📊 Railway Production Database Analysis');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    // Get current state
    const currentMega = await client.query('SELECT COALESCE(balance,0) as balance FROM wallets WHERE owner_id IS NULL AND wallet_type=$1', ['MEGA_ACCOUNT']);
    const totalDeposits = await client.query('SELECT COALESCE(SUM(total_deposited),0) as total FROM users WHERE role=$1', ['user']);
    const totalMembers = await client.query('SELECT COUNT(*) as count FROM users WHERE role=$1', ['user']);
    const activeMembers = await client.query('SELECT COUNT(*) as count FROM users WHERE role=$1 AND is_active=true', ['user']);

    console.log('Current State:');
    console.log('  Total Members:', totalMembers.rows[0].count);
    console.log('  Active Members:', activeMembers.rows[0].count);
    console.log('  Total Deposits:', '₹' + totalDeposits.rows[0].total);
    console.log('  Current MEGA_ACCOUNT:', '₹' + currentMega.rows[0].balance);
    console.log('');

    // Calculate what should have been debited
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

    console.log('REAL_USER Payouts (should have debited MEGA_ACCOUNT):');
    console.log('  Pair Income:', '₹' + pairIncome.rows[0].total);
    console.log('  Referral Income:', '₹' + referralIncome.rows[0].total);
    console.log('  Milestone Commission:', '₹' + milestoneIncome.rows[0].total);
    console.log('  PMI Income:', '₹' + pmiIncome.rows[0].total);
    console.log('  Total to Debit:', '₹' + totalToDebit);
    console.log('');

    const calculatedMega = parseFloat(totalDeposits.rows[0].total) - totalToDebit;
    const currentMegaBalance = parseFloat(currentMega.rows[0].balance);
    const difference = currentMegaBalance - calculatedMega;

    console.log('MEGA_ACCOUNT Calculation:');
    console.log('  Calculated MEGA_ACCOUNT:', '₹' + calculatedMega);
    console.log('  Current MEGA_ACCOUNT:', '₹' + currentMegaBalance);
    console.log('  Difference (overstated by):', '₹' + difference);
    console.log('');

    if (difference > 0) {
      console.log('✅ CORRECTION NEEDED');
      console.log('   MEGA_ACCOUNT is overstated by ₹' + difference);
      console.log('   Run the correction script to debit ₹' + difference + ' from MEGA_ACCOUNT');
    } else if (difference < 0) {
      console.log('⚠️  UNEXPECTED STATE');
      console.log('   MEGA_ACCOUNT is understated by ₹' + Math.abs(difference));
      console.log('   Manual investigation required');
    } else {
      console.log('✅ NO CORRECTION NEEDED');
      console.log('   MEGA_ACCOUNT is already correct');
    }

  } catch (err) {
    console.error('❌ Error:', err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
})();

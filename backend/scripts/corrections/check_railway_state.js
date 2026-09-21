/**
 * Check Current Railway Database State
 *
 * This script checks the actual current state of Railway's database
 * to see if it matches what the dashboard is showing.
 */

const Pool = require('pg').Pool;
const pool = new Pool({
  connectionString: 'postgresql://postgres:kxllqjdGDkwnxMlzvkZaVsLIvVtdKTcp@postgres.railway.internal:5432/railway'
});

(async () => {
  const client = await pool.connect();
  try {
    console.log('📊 Current Railway Database State');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    const megaWallet = await client.query('SELECT * FROM wallets WHERE owner_id IS NULL AND wallet_type=$1', ['MEGA_ACCOUNT']);
    const companyWallet = await client.query('SELECT * FROM wallets WHERE owner_id IS NULL AND wallet_type=$1', ['COMPANY_EARNED']);
    const totalDeposits = await client.query('SELECT COALESCE(SUM(total_deposited),0) as total FROM users WHERE role=$1', ['user']);
    const totalMembers = await client.query('SELECT COUNT(*) as count FROM users WHERE role=$1', ['user']);
    const activeMembers = await client.query('SELECT COUNT(*) as count FROM users WHERE role=$1 AND is_active=true', ['user']);

    console.log('Actual Database Values:');
    console.log('  Total Members:', totalMembers.rows[0].count);
    console.log('  Active Members:', activeMembers.rows[0].count);
    console.log('  Total Deposits:', '₹' + totalDeposits.rows[0].total);
    console.log('  MEGA_ACCOUNT:', '₹' + megaWallet.rows[0].balance);
    console.log('  COMPANY_EARNED:', '₹' + companyWallet.rows[0].balance);
    console.log('  MEGA_ACCOUNT Updated:', megaWallet.rows[0].updated_at);
    console.log('');

    console.log('Dashboard Shows:');
    console.log('  Total Members: 14');
    console.log('  Active Members: 14');
    console.log('  Total Deposits: ₹1,75,000');
    console.log('  MEGA_ACCOUNT: ₹1,47,000');
    console.log('  COMPANY_EARNED: ₹28,000');
    console.log('');

    if (parseFloat(megaWallet.rows[0].balance) === 217300) {
      console.log('✅ Database is at original state (undo worked)');
    } else {
      console.log('❌ Database is NOT at original state');
    }

  } catch (err) {
    console.error('❌ Error:', err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
})();

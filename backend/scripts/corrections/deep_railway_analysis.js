/**
 * Deep Analysis of Railway Production Database
 *
 * Find out why MEGA_ACCOUNT is higher than total deposits
 */

const Pool = require('pg').Pool;
const pool = new Pool({
  connectionString: 'postgresql://postgres:kxllqjdGDkwnxMlzvkZaVsLIvVtdKTcp@postgres.railway.internal:5432/railway'
});

(async () => {
  const client = await pool.connect();
  try {
    console.log('🔍 Deep Railway Database Analysis');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    // 1. Check all mega_ledger entries
    const megaLedger = await client.query('SELECT * FROM mega_ledger ORDER BY id DESC LIMIT 20');
    console.log('\n📊 Recent MEGA_ACCOUNT Ledger Entries:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    let totalInflow = 0;
    let totalOutflow = 0;
    let totalInternal = 0;
    for (const entry of megaLedger.rows) {
      const amount = parseFloat(entry.amount);
      if (entry.transaction_type === 'INFLOW') {
        totalInflow += amount;
        console.log(`+ ₹${amount} | ${entry.transaction_type} | ${entry.category} | ${entry.description?.substring(0, 50)}...`);
      } else if (entry.transaction_type === 'OUTFLOW') {
        totalOutflow += amount;
        console.log(`- ₹${amount} | ${entry.transaction_type} | ${entry.category} | ${entry.description?.substring(0, 50)}...`);
      } else {
        totalInternal += amount;
        console.log(`* ₹${amount} | ${entry.transaction_type} | ${entry.category} | ${entry.description?.substring(0, 50)}...`);
      }
    }
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('Total INFLOW:', '₹' + totalInflow);
    console.log('Total OUTFLOW:', '₹' + totalOutflow);
    console.log('Total INTERNAL:', '₹' + totalInternal);
    console.log('Net (INFLOW - OUTFLOW):', '₹' + (totalInflow - totalOutflow));

    // 2. Check all deposits
    const deposits = await client.query('SELECT * FROM deposits ORDER BY id DESC LIMIT 10');
    console.log('\n📊 Recent Deposits:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    let totalDeposits = 0;
    for (const dep of deposits.rows) {
      const amount = parseFloat(dep.amount);
      if (dep.status === 'approved') {
        totalDeposits += amount;
        console.log(`+ ₹${amount} | User: ${dep.user_id} | Status: ${dep.status}`);
      }
    }
    console.log('Total Approved Deposits:', '₹' + totalDeposits);

    // 3. Check current wallet balance
    const megaWallet = await client.query('SELECT * FROM wallets WHERE owner_id IS NULL AND wallet_type=$1', ['MEGA_ACCOUNT']);
    console.log('\n📊 Current MEGA_ACCOUNT Wallet:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('Balance:', '₹' + megaWallet.rows[0].balance);
    console.log('Updated:', megaWallet.rows[0].updated_at);

    // 4. Check for any manual adjustments or company income credited to MEGA_ACCOUNT
    const companyTransactions = await client.query(`
      SELECT * FROM transactions
      WHERE attributed_to = 'COMPANY_PLACED'
      AND status = 'credited'
      ORDER BY id DESC LIMIT 10
    `);
    console.log('\n📊 COMPANY_PLACED Transactions:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    for (const tx of companyTransactions.rows) {
      console.log(`₹${tx.net_amount} | ${tx.income_type} | User: ${tx.user_id}`);
    }

    // 5. Calculate expected vs actual
    const userTotalDeposits = await client.query('SELECT COALESCE(SUM(total_deposited),0) as total FROM users WHERE role=$1', ['user']);
    const expectedMega = parseFloat(userTotalDeposits.rows[0].total) - totalOutflow;
    const actualMega = parseFloat(megaWallet.rows[0].balance);
    const difference = actualMega - expectedMega;

    console.log('\n📊 Expected vs Actual MEGA_ACCOUNT:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('User Deposits:', '₹' + userTotalDeposits.rows[0].total);
    console.log('Outflows:', '₹' + totalOutflow);
    console.log('Expected MEGA_ACCOUNT:', '₹' + expectedMega);
    console.log('Actual MEGA_ACCOUNT:', '₹' + actualMega);
    console.log('Difference (mystery money):', '₹' + difference);

    if (difference > 0) {
      console.log('\n⚠️  MYSTERY MONEY DETECTED!');
      console.log('    MEGA_ACCOUNT has ₹' + difference + ' more than expected');
      console.log('    This could be from:');
      console.log('    - Manual wallet adjustments');
      console.log('    - Company income incorrectly credited to MEGA_ACCOUNT');
      console.log('    - Corrupted data');
    }

  } catch (err) {
    console.error('❌ Error:', err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
})();

/**
 * Fix COMPANY_PLACED Income Attribution - Railway Production
 *
 * PROBLEM:
 * COMPANY_PLACED income was incorrectly credited to MEGA_ACCOUNT instead of
 * COMPANY_EARNED. This caused MEGA_ACCOUNT to be overstated.
 *
 * SOLUTION:
 * Move COMPANY_PLACED income from MEGA_ACCOUNT to COMPANY_EARNED.
 */

const Pool = require('pg').Pool;
const pool = new Pool({
  connectionString: 'postgresql://postgres:kxllqjdGDkwnxMlzvkZaVsLIvVtdKTcp@postgres.railway.internal:5432/railway'
});

(async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    console.log('🔍 Fixing COMPANY_PLACED Income Attribution');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    // Calculate total COMPANY_PLACED income
    const companyIncome = await client.query(`
      SELECT COALESCE(SUM(net_amount), 0) as total
      FROM transactions
      WHERE attributed_to = 'COMPANY_PLACED'
      AND status = 'credited'
    `);
    const totalCompanyIncome = parseFloat(companyIncome.rows[0].total);

    console.log('Total COMPANY_PLACED Income:', '₹' + totalCompanyIncome);

    // Get current wallet balances
    const megaWallet = await client.query('SELECT * FROM wallets WHERE owner_id IS NULL AND wallet_type=$1', ['MEGA_ACCOUNT']);
    const companyWallet = await client.query('SELECT * FROM wallets WHERE owner_id IS NULL AND wallet_type=$1', ['COMPANY_EARNED']);

    const currentMega = parseFloat(megaWallet.rows[0].balance);
    const currentCompany = parseFloat(companyWallet.rows[0].balance);

    console.log('Current MEGA_ACCOUNT:', '₹' + currentMega);
    console.log('Current COMPANY_EARNED:', '₹' + currentCompany);
    console.log('');

    // Move COMPANY_PLACED income from MEGA_ACCOUNT to COMPANY_EARNED
    await client.query('UPDATE wallets SET balance=balance-$1, updated_at=NOW() WHERE id=$2', [totalCompanyIncome, megaWallet.rows[0].id]);
    await client.query('UPDATE wallets SET balance=balance+$1, updated_at=NOW() WHERE id=$2', [totalCompanyIncome, companyWallet.rows[0].id]);

    // Record in mega_ledger
    await client.query(
      'INSERT INTO mega_ledger (transaction_type, category, amount, related_wallet_id, description) VALUES ($1, $2, $3, $4, $5)',
      ['INTERNAL_ALLOCATION', 'correction', totalCompanyIncome, megaWallet.rows[0].id, 'Railway Correction: Move COMPANY_PLACED income from MEGA_ACCOUNT to COMPANY_EARNED']
    );

    await client.query('COMMIT');

    console.log('✅ COMPANY_PLACED income attribution fixed');
    console.log('Moved ₹' + totalCompanyIncome + ' from MEGA_ACCOUNT to COMPANY_EARNED');
    console.log('New MEGA_ACCOUNT:', '₹' + (currentMega - totalCompanyIncome));
    console.log('New COMPANY_EARNED:', '₹' + (currentCompany + totalCompanyIncome));

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Error:', err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
})();

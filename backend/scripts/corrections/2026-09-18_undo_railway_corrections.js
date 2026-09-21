/**
 * Undo Railway Corrections - 2026-09-18
 *
 * PROBLEM:
 * I made incorrect corrections based on wrong understanding of business logic.
 * 
 * CORRECTIONS MADE (WRONG):
 * 1. Debited ₹6,000 from MEGA_ACCOUNT for REAL_USER payouts
 * 2. Moved ₹16,000 from MEGA_ACCOUNT to COMPANY_EARNED for COMPANY_PLACED income
 *
 * CORRECT BUSINESS LOGIC:
 * - MEGA_ACCOUNT = What company is left with after all distribution
 * - Company earnings also come from MEGA_ACCOUNT (company payout from treasury)
 * - COMPANY_EARNED is just for tracking, not actual cash storage
 *
 * UNDO PLAN:
 * Restore MEGA_ACCOUNT to ₹217,300 (original state)
 * Restore COMPANY_EARNED to ₹0 (original state)
 */

const Pool = require('pg').Pool;
const pool = new Pool({
  connectionString: 'postgresql://postgres:kxllqjdGDkwnxMlzvkZaVsLIvVtdKTcp@postgres.railway.internal:5432/railway'
});

(async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    console.log('🔄 Undoing Railway Corrections');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    // Get current balances
    const megaWallet = await client.query('SELECT * FROM wallets WHERE owner_id IS NULL AND wallet_type=$1', ['MEGA_ACCOUNT']);
    const companyWallet = await client.query('SELECT * FROM wallets WHERE owner_id IS NULL AND wallet_type=$1', ['COMPANY_EARNED']);

    const currentMega = parseFloat(megaWallet.rows[0].balance);
    const currentCompany = parseFloat(companyWallet.rows[0].balance);

    console.log('Current MEGA_ACCOUNT:', '₹' + currentMega);
    console.log('Current COMPANY_EARNED:', '₹' + currentCompany);
    console.log('');

    // Restore to original state
    // MEGA_ACCOUNT should be ₹217,300
    // COMPANY_EARNED should be ₹0
    const targetMega = 217300;
    const targetCompany = 0;

    const megaRestore = targetMega - currentMega;
    const companyRestore = targetCompany - currentCompany;

    console.log('Restoring MEGA_ACCOUNT:', '₹' + megaRestore);
    console.log('Restoring COMPANY_EARNED:', '₹' + companyRestore);
    console.log('');

    await client.query('UPDATE wallets SET balance=balance+$1, updated_at=NOW() WHERE id=$2', [megaRestore, megaWallet.rows[0].id]);
    await client.query('UPDATE wallets SET balance=balance+$1, updated_at=NOW() WHERE id=$2', [companyRestore, companyWallet.rows[0].id]);

    // Delete correction entries from mega_ledger
    await client.query('DELETE FROM mega_ledger WHERE category=$1', ['correction']);

    await client.query('COMMIT');

    console.log('✅ Corrections undone');
    console.log('MEGA_ACCOUNT restored to: ₹' + targetMega);
    console.log('COMPANY_EARNED restored to: ₹' + targetCompany);

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Error:', err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
})();

/**
 * MEGA_ACCOUNT Correction Undo - 2026-09-17
 * 
 * PURPOSE:
 * This script undoes the MEGA_ACCOUNT correction made by 2026-09-17_fix_mega_account_debit.js
 * 
 * USE CASE:
 * Only run this if the correction was applied incorrectly and needs to be reverted.
 * This should NOT be run in normal circumstances.
 * 
 * WHAT IT DOES:
 * - Adds back ₹148,000 to MEGA_ACCOUNT
 * - Deletes the correction entry from mega_ledger
 * 
 * RUN ON: 2026-09-17 (if needed)
 * CORRESPONDING FIX: 2026-09-17_fix_mega_account_debit.js
 */

const pool = require('../../db');

(async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Undo previous correction
    const megaWallet = await client.query('SELECT * FROM wallets WHERE owner_id IS NULL AND wallet_type=$1', ['MEGA_ACCOUNT']);
    await client.query('UPDATE wallets SET balance=balance+$1, updated_at=NOW() WHERE id=$2', [148000, megaWallet.rows[0].id]);

    // Delete previous correction entry
    await client.query('DELETE FROM mega_ledger WHERE category=$1', ['correction']);

    await client.query('COMMIT');
    console.log('✅ Previous correction undone');
    console.log('MEGA_ACCOUNT restored to: ₹' + (parseFloat(megaWallet.rows[0].balance) + 148000));
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Error:', err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
})();

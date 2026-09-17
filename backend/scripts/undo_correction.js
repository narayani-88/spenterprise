const pool = require('../db');

(async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Undo previous correction
    const megaWallet = await client.query('SELECT * FROM wallets WHERE owner_id IS NULL AND wallet_type=$1', ['MEGA_ACCOUNT']);
    await client.query('UPDATE wallets SET balance=balance+$1, updated_at=NOW() WHERE id=$2', [128000, megaWallet.rows[0].id]);

    // Delete previous correction entry
    await client.query('DELETE FROM mega_ledger WHERE category=$1', ['correction']);

    await client.query('COMMIT');
    console.log('✅ Previous correction undone');
    console.log('MEGA_ACCOUNT restored to: ₹' + (parseFloat(megaWallet.rows[0].balance) + 128000));
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Error:', err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
})();

/**
 * Inspect BAP0006 (Shivanjali Pandey) details, referrals, and transactions
 */
const pool = require('../db');

async function inspect() {
  const client = await pool.connect();
  try {
    console.log('=== INSPECTING SHIVANJALI (BAP0006) ===\n');

    const uRes = await client.query(`
      SELECT id, member_id, name, referral_code, sponsor_id, source_type, role,
             wallet_balance, pending_balance, total_deposited, is_active
      FROM users
      WHERE member_id = 'BAP0006' OR referral_code = 'BAP0006' OR name ILIKE '%shivanjali%'
    `);
    
    if (uRes.rows.length === 0) {
      console.log('User not found!');
      return;
    }

    const u = uRes.rows[0];
    console.log('User details:');
    console.table([u]);

    // Who did this user refer?
    const refs = await client.query(`
      SELECT id, member_id, name, source_type, is_active, total_deposited, created_at
      FROM users
      WHERE sponsor_id = $1
    `, [u.id]);
    console.log(`\nDirect Referrals (${refs.rows.length}):`);
    console.table(refs.rows);

    // All transactions for this user
    const txs = await client.query(`
      SELECT id, income_type, amount, net_amount, description, status, attributed_to, created_at
      FROM transactions
      WHERE user_id = $1
      ORDER BY id ASC
    `, [u.id]);
    console.log(`\nTransactions (${txs.rows.length}):`);
    console.table(txs.rows);

    // Wallets
    const w = await client.query(`
      SELECT id, owner_id, wallet_type, balance, updated_at
      FROM wallets
      WHERE owner_id = $1 OR (owner_id IS NULL AND wallet_type = 'COMPANY_EARNED')
    `, [u.id]);
    console.log('\nWallets:');
    console.table(w.rows);

  } finally {
    client.release();
    pool.end();
  }
}

inspect().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});

/**
 * Ledger Rebalance Utility
 * Run: node backend/scripts/rebalance_wallets.js
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const pool = require('../db');

async function rebalanceAllWallets() {
  const client = await pool.connect();
  try {
    console.log('🔄 Starting Database Wallet Deduplication & Re-balancing...\n');
    await client.query('BEGIN');

    // 1. Remove duplicate company-level wallets if any exist
    await client.query(`
      DELETE FROM wallets w1
      USING wallets w2
      WHERE w1.owner_id IS NULL 
        AND w2.owner_id IS NULL 
        AND w1.wallet_type = w2.wallet_type 
        AND w1.id > w2.id;
    `);

    // 2. Ensure company unique partial index exists
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_company_wallets_unique 
      ON wallets (wallet_type) 
      WHERE owner_id IS NULL;
    `);

    // 3. Ensure all 4 company-level wallets exist
    const companyTypes = ['MEGA_ACCOUNT', 'COMPANY_EARNED', 'TDS_PAYABLE', 'NWF_POOL'];
    for (const t of companyTypes) {
      await client.query(`
        INSERT INTO wallets (owner_id, wallet_type, balance)
        VALUES (NULL, $1, 0)
        ON CONFLICT (wallet_type) WHERE owner_id IS NULL DO NOTHING;
      `, [t]);
    }

    // 4. Calculate total deposits collected
    const depRes = await client.query("SELECT COALESCE(SUM(total_deposited), 0) AS total FROM users WHERE role='user'");
    const totalDeposits = parseFloat(depRes.rows[0].total || 0);

    // 5. Calculate total net cash paid out on approved withdrawals
    const withRes = await client.query("SELECT COALESCE(SUM(net_amount), 0) AS total FROM withdrawal_requests WHERE status='approved'");
    const totalPaidOut = parseFloat(withRes.rows[0].total || 0);

    // 6. Calculate total historical TDS (5%) and NWF (10%) withheld from approved withdrawals
    const withholdRes = await client.query(`
      SELECT COALESCE(SUM(tds_amount), 0) AS total_tds, COALESCE(SUM(nwi_amount), 0) AS total_nwf
      FROM withdrawal_requests WHERE status='approved'
    `);
    const totalTds = parseFloat(withholdRes.rows[0].total_tds || 0);
    const totalNwf = parseFloat(withholdRes.rows[0].total_nwf || 0);

    // 7. Calculate real company profit earned by COMPANY_PLACED tree IDs
    const compProfitRes = await client.query(`
      SELECT COALESCE(SUM(net_amount), 0) AS profit
      FROM transactions
      WHERE attributed_to = 'COMPANY_PLACED' 
        AND status = 'credited' 
        AND income_type IN ('pair_income', 'referral_income', 'smi_family_bonus', 'non_working_income')
    `);
    const companyProfit = parseFloat(compProfitRes.rows[0].profit || 0);

    // 8. Update balances in wallets table
    const megaTreasury = Math.max(0, parseFloat((totalDeposits - totalPaidOut).toFixed(2)));

    await client.query("UPDATE wallets SET balance=$1, updated_at=NOW() WHERE owner_id IS NULL AND wallet_type='MEGA_ACCOUNT'", [megaTreasury]);
    await client.query("UPDATE wallets SET balance=$1, updated_at=NOW() WHERE owner_id IS NULL AND wallet_type='COMPANY_EARNED'", [companyProfit]);
    await client.query("UPDATE wallets SET balance=$1, updated_at=NOW() WHERE owner_id IS NULL AND wallet_type='TDS_PAYABLE'", [totalTds]);
    await client.query("UPDATE wallets SET balance=$1, updated_at=NOW() WHERE owner_id IS NULL AND wallet_type='NWF_POOL'", [totalNwf]);

    // 9. Sync user USER_PAYABLE wallets with users.wallet_balance
    await client.query(`
      INSERT INTO wallets (owner_id, wallet_type, balance)
      SELECT id, 'USER_PAYABLE', wallet_balance
      FROM users WHERE role='user'
      ON CONFLICT (owner_id, wallet_type) DO UPDATE
      SET balance = EXCLUDED.balance, updated_at = NOW();
    `);

    await client.query('COMMIT');

    console.log('✅ REBALANCE COMPLETE! Sub-Ledgers Breakdown:');
    console.log(`  💰 Total Deposits Collected : ₹${totalDeposits}`);
    console.log(`  💸 Total Net Cash Paid Out   : ₹${totalPaidOut}`);
    console.log(`  🏦 MEGA ACCOUNT (Treasury)   : ₹${megaTreasury}`);
    console.log(`  💼 COMPANY_EARNED (Profit)   : ₹${companyProfit}`);
    console.log(`  🏛️ TDS_PAYABLE (Govt Tax)    : ₹${totalTds}`);
    console.log(`  🛡️ NWF_POOL (Retention)      : ₹${totalNwf}\n`);

    const summary = await client.query('SELECT * FROM wallets WHERE owner_id IS NULL ORDER BY id');
    console.table(summary.rows);

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Rebalance failed:', err);
  } finally {
    client.release();
    await pool.end();
  }
}

rebalanceAllWallets();

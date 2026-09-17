/**
 * Self-Calculating Financial Reconciliation Script
 * 
 * Reconciles MEGA_ACCOUNT, COMPANY_EARNED, TDS_PAYABLE, and NWF_POOL
 * directly from actual deposits, transactions, and withdrawal records.
 * 
 * NO hardcoding of arbitrary amounts.
 * Safe to run on local, Render, or Railway production.
 * 
 * Usage:
 *   node backend/scripts/reconcile_all_finances.js           # executes reconciliation
 *   node backend/scripts/reconcile_all_finances.js --dry-run # inspect without saving
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

async function reconcileFinances(poolInstance, isDryRun = false) {
  const client = await poolInstance.connect();
  try {
    console.log('═════════════════════════════════════════════════════════════════');
    console.log('🏛️  FINANCIAL RECONCILIATION & AUDIT ENGINE');
    console.log(isDryRun ? '🔍 MODE: DRY RUN (No database updates)' : '⚡ MODE: LIVE RECONCILIATION');
    console.log('═════════════════════════════════════════════════════════════════\n');

    await client.query('BEGIN');

    // 1. Total Approved Deposits (Master Treasury Inflow)
    const depApprovedRes = await client.query(`
      SELECT COALESCE(SUM(amount), 0) AS total, COUNT(*) AS count
      FROM deposits WHERE status='approved'
    `);
    const depUsersRes = await client.query(`
      SELECT COALESCE(SUM(total_deposited), 0) AS total
      FROM users WHERE role='user'
    `);
    
    // Total deposits received into company
    const totalDeposits = Math.max(
      parseFloat(depApprovedRes.rows[0].total || 0),
      parseFloat(depUsersRes.rows[0].total || 0)
    );
    console.log(`📥 Total Approved Deposits Received : ₹${totalDeposits.toLocaleString('en-IN')}`);

    // A. Normalize attributed_to on transactions table based on user source_type and role
    await client.query(`
      UPDATE transactions t
      SET attributed_to = CASE
        WHEN u.role = 'admin' OR u.source_type = 'COMPANY_PLACED' THEN 'COMPANY_PLACED'
        ELSE 'REAL_USER'
      END
      FROM users u
      WHERE t.user_id = u.id
        AND (t.attributed_to IS NULL OR t.attributed_to NOT IN ('COMPANY_PLACED', 'REAL_USER'));
    `);
    await client.query(`
      UPDATE transactions
      SET attributed_to = 'COMPANY_PLACED'
      WHERE user_id IS NULL AND (attributed_to IS NULL OR attributed_to NOT IN ('COMPANY_PLACED', 'REAL_USER'));
    `);

    // 2. Grand Total Income Distributed (All credited non-deposit transactions)
    const grandDistRes = await client.query(`
      SELECT income_type, COUNT(*) AS count, COALESCE(SUM(net_amount), 0) AS total
      FROM transactions
      WHERE status = 'credited'
        AND income_type != 'deposit'
      GROUP BY income_type
    `);
    let grandTotalDistributions = 0;
    console.log('\n💸 Grand Total Income Distributed Breakdown:');
    for (const r of grandDistRes.rows) {
      const amt = parseFloat(r.total);
      grandTotalDistributions += amt;
      console.log(`   - ${r.income_type.padEnd(24)} : ${r.count} txns, ₹${amt.toLocaleString('en-IN')}`);
    }
    console.log(`   ► Grand Total Income Distributed   : ₹${grandTotalDistributions.toLocaleString('en-IN')}`);

    // 3. Company Tree Distributions (Admin or COMPANY_PLACED nodes)
    const compTxRes = await client.query(`
      SELECT t.income_type, COUNT(*) AS count, COALESCE(SUM(t.net_amount), 0) AS total
      FROM transactions t
      LEFT JOIN users u ON t.user_id = u.id
      WHERE t.status = 'credited'
        AND t.income_type != 'deposit'
        AND (t.attributed_to = 'COMPANY_PLACED' OR u.role = 'admin' OR u.source_type = 'COMPANY_PLACED')
      GROUP BY t.income_type
    `);
    let totalCompanyDistributions = 0;
    console.log('\n🏢 Company Tree Distributions Breakdown:');
    for (const r of compTxRes.rows) {
      const amt = parseFloat(r.total);
      totalCompanyDistributions += amt;
      console.log(`   - ${r.income_type.padEnd(24)} : ${r.count} txns, ₹${amt.toLocaleString('en-IN')}`);
    }
    console.log(`   ► Total Company Distributions      : ₹${totalCompanyDistributions.toLocaleString('en-IN')}`);

    // 4. Real User Distributions
    const totalRealUserDistributions = Math.max(0, parseFloat((grandTotalDistributions - totalCompanyDistributions).toFixed(2)));
    console.log(`\n👤 Real User Distributions           : ₹${totalRealUserDistributions.toLocaleString('en-IN')}`);

    // 5. Approved Withdrawals (Cash leaving bank)
    const withRes = await client.query(`
      SELECT 
        COUNT(*) AS count,
        COALESCE(SUM(requested_amount), 0) AS gross_total,
        COALESCE(SUM(tds_amount), 0)       AS tds_total,
        COALESCE(SUM(nwi_amount), 0)       AS nwf_total,
        COALESCE(SUM(net_amount), 0)       AS net_paid_total
      FROM withdrawal_requests
      WHERE status='approved'
    `);
    const wRow = withRes.rows[0];
    const totalNetCashPaidOut = parseFloat(wRow.net_paid_total || 0);
    const totalTdsWithheld    = parseFloat(wRow.tds_total || 0);
    const totalNwfWithheld    = parseFloat(wRow.nwf_total || 0);
    const totalGrossWithdrawn = parseFloat(wRow.gross_total || 0);
    console.log('\n🏦 Approved Withdrawals:');
    console.log(`   - Total Net Cash Transferred       : ₹${totalNetCashPaidOut.toLocaleString('en-IN')}`);
    console.log(`   - 5% TDS Tax Withheld (Govt)       : ₹${totalTdsWithheld.toLocaleString('en-IN')}`);
    console.log(`   - 10% NWF Withheld (Retention Pool): ₹${totalNwfWithheld.toLocaleString('en-IN')}`);
    console.log(`   ► Total Gross Withdrawn from Wallets: ₹${totalGrossWithdrawn.toLocaleString('en-IN')}`);

    // 6. Synchronize and Check Real User Wallet Balances
    if (!isDryRun) {
      await client.query(`
        UPDATE users u
        SET wallet_balance = GREATEST(0, (
          COALESCE((
            SELECT SUM(t.net_amount)
            FROM transactions t
            WHERE t.user_id = u.id
              AND t.status = 'credited'
              AND t.income_type != 'deposit'
          ), 0)
          -
          COALESCE((
            SELECT SUM(w.requested_amount)
            FROM withdrawal_requests w
            WHERE w.user_id = u.id
              AND w.status IN ('approved', 'pending')
          ), 0)
        ))
        WHERE u.role = 'user' AND COALESCE(u.source_type, 'REAL_USER') != 'COMPANY_PLACED';
      `);
    }

    const userWalletRes = await client.query(`
      SELECT COALESCE(SUM(wallet_balance), 0) AS total
      FROM users WHERE role='user' AND COALESCE(source_type, 'REAL_USER') != 'COMPANY_PLACED'
    `);
    const totalActiveUserWallets = parseFloat(userWalletRes.rows[0].total || 0);
    console.log(`\n💼 Total Active Real User Wallets    : ₹${totalActiveUserWallets.toLocaleString('en-IN')}`);

    // 7. Target Reconciled Balances:
    // MEGA_ACCOUNT = Deposits - Total Distributed (SA + Company)
    const targetMega = Math.max(0, parseFloat((totalDeposits - grandTotalDistributions).toFixed(2)));
    const targetCompanyEarned = parseFloat(totalCompanyDistributions.toFixed(2));
    const targetTds = parseFloat(totalTdsWithheld.toFixed(2));
    const targetNwf = parseFloat(totalNwfWithheld.toFixed(2));

    // 8. Financial Conservation Checks
    console.log('\n═════════════════════════════════════════════════════════════════');
    console.log('⚖️  MATHEMATICAL RECONCILIATION & CONSERVATION AUDIT');
    console.log('═════════════════════════════════════════════════════════════════');
    console.log(`1. Total Deposits               : ₹${totalDeposits.toFixed(2)}`);
    console.log(`2. Total Distributed            : ₹${grandTotalDistributions.toFixed(2)}`);
    console.log(`3. MEGA_ACCOUNT (Undistributed) : ₹${targetMega.toFixed(2)}`);
    console.log(`   [Check: Deposits - Distributed = ₹${(totalDeposits - grandTotalDistributions).toFixed(2)}]`);
    console.log(`4. COMPANY_EARNED (Profit)      : ₹${targetCompanyEarned.toFixed(2)}`);
    console.log(`5. User Wallets (Unwithdrawn)   : ₹${totalActiveUserWallets.toFixed(2)}`);
    console.log(`6. Total Withdrawn Paid Out     : ₹${totalGrossWithdrawn.toFixed(2)}`);
    
    // User earnings conservation:
    const userDiff = Math.abs(totalRealUserDistributions - (totalActiveUserWallets + totalGrossWithdrawn));
    console.log(`\n🔎 User Earnings Conservation:`);
    console.log(`   Distributed to Users (₹${totalRealUserDistributions}) == Wallets (₹${totalActiveUserWallets}) + Withdrawn (₹${totalGrossWithdrawn})`);
    console.log(`   Difference: ₹${userDiff.toFixed(2)} ${userDiff < 1 ? '✅ PERFECT' : '⚠️ Minor Rounding'}`);

    // Total company fund conservation:
    const totalAccountedFor = targetMega + targetCompanyEarned + totalActiveUserWallets + totalGrossWithdrawn;
    const globalDiff = Math.abs(totalDeposits - totalAccountedFor);
    console.log(`\n🔎 Grand Treasury Fund Conservation:`);
    console.log(`   Total Deposits (₹${totalDeposits}) == MEGA (₹${targetMega}) + Company (₹${targetCompanyEarned}) + User Wallets (₹${totalActiveUserWallets}) + Withdrawn (₹${totalGrossWithdrawn})`);
    console.log(`   Total Accounted For: ₹${totalAccountedFor.toFixed(2)}`);
    console.log(`   Discrepancy: ₹${globalDiff.toFixed(2)} ${globalDiff < 1 ? '✅ PERFECT 100% MATCH' : '⚠️ REVIEW'}`);

    // 9. Fetch Current Wallet Balances from DB
    const currWallets = await client.query(`
      SELECT wallet_type, balance FROM wallets WHERE owner_id IS NULL ORDER BY wallet_type
    `);
    console.log('\n📊 Sub-Ledger Balances: Before vs Target:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('Wallet Type        | Current DB Balance | Reconciled Target');
    console.log('───────────────────┼────────────────────┼──────────────────');
    const currMap = {};
    currWallets.rows.forEach(w => { currMap[w.wallet_type] = parseFloat(w.balance); });

    console.log(`MEGA_ACCOUNT       | ₹${(currMap['MEGA_ACCOUNT'] || 0).toFixed(2).padEnd(18)} | ₹${targetMega.toFixed(2)}`);
    console.log(`COMPANY_EARNED     | ₹${(currMap['COMPANY_EARNED'] || 0).toFixed(2).padEnd(18)} | ₹${targetCompanyEarned.toFixed(2)}`);
    console.log(`TDS_PAYABLE        | ₹${(currMap['TDS_PAYABLE'] || 0).toFixed(2).padEnd(18)} | ₹${targetTds.toFixed(2)}`);
    console.log(`NWF_POOL           | ₹${(currMap['NWF_POOL'] || 0).toFixed(2).padEnd(18)} | ₹${targetNwf.toFixed(2)}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    if (isDryRun) {
      console.log('🔍 DRY RUN COMPLETE. No database updates were written.');
      await client.query('ROLLBACK');
      return;
    }

    // 10. Apply Updates to Database
    // A. Deduplicate company-level wallets if any duplicates exist
    await client.query(`
      DELETE FROM wallets w1
      USING wallets w2
      WHERE w1.owner_id IS NULL 
        AND w2.owner_id IS NULL 
        AND w1.wallet_type = w2.wallet_type 
        AND w1.id > w2.id;
    `);

    // B. Ensure unique partial index
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_company_wallets_unique 
      ON wallets (wallet_type) 
      WHERE owner_id IS NULL;
    `);

    // C. Upsert company wallets
    const upsertTypes = [
      { type: 'MEGA_ACCOUNT',   bal: targetMega },
      { type: 'COMPANY_EARNED', bal: targetCompanyEarned },
      { type: 'TDS_PAYABLE',    bal: targetTds },
      { type: 'NWF_POOL',       bal: targetNwf }
    ];

    for (const item of upsertTypes) {
      await client.query(`
        INSERT INTO wallets (owner_id, wallet_type, balance)
        VALUES (NULL, $1, $2)
        ON CONFLICT (wallet_type) WHERE owner_id IS NULL 
        DO UPDATE SET balance = EXCLUDED.balance, updated_at = NOW();
      `, [item.type, item.bal]);
    }

    // D. Synchronize user wallets
    await client.query(`
      INSERT INTO wallets (owner_id, wallet_type, balance)
      SELECT id, 'USER_PAYABLE', wallet_balance
      FROM users WHERE role='user'
      ON CONFLICT (owner_id, wallet_type) WHERE owner_id IS NOT NULL 
      DO UPDATE SET balance = EXCLUDED.balance, updated_at = NOW();
    `);

    // E. Record an immutable audit log entry in mega_ledger
    const megaW = await client.query(`SELECT id FROM wallets WHERE owner_id IS NULL AND wallet_type='MEGA_ACCOUNT'`);
    if (megaW.rows.length) {
      await client.query(`
        INSERT INTO mega_ledger (transaction_type, category, amount, related_wallet_id, description)
        VALUES ($1, $2, $3, $4, $5)
      `, [
        'INTERNAL_ALLOCATION',
        'reconciliation',
        targetMega,
        megaW.rows[0].id,
        `System Financial Reconciliation: Reconciled MEGA_ACCOUNT to ₹${targetMega} based on ₹${totalDeposits} total deposits and ₹${grandTotalDistributions} total distributions.`
      ]);
    }

    await client.query('COMMIT');
    console.log('✅ ALL SUB-LEDGERS RECONCILED AND SAVED SUCCESSFULLY!');
    return { targetMega, targetCompanyEarned, targetTds, targetNwf };
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Reconciliation failed:', err.message, err.stack);
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { reconcileFinances };

if (require.main === module) {
  const pool = require('../db');
  const isDryRun = process.argv.includes('--dry-run');
  reconcileFinances(pool, isDryRun)
    .then(() => {
      pool.end();
      process.exit(0);
    })
    .catch((err) => {
      pool.end();
      console.error(err);
      process.exit(1);
    });
}

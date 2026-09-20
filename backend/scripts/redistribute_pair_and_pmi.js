/**
 * Pair Income & PMI Redistribution Engine
 * 
 * Safely resets pair matching and PMI family bonus transactions,
 * recomputes accurate left/right subtree counts from the binary tree,
 * executes the updated pair matching & PMI cascade logic,
 * and reconciles all balances (user wallets, MEGA_ACCOUNT, COMPANY_EARNED).
 * 
 * Usage:
 *   node backend/scripts/redistribute_pair_and_pmi.js --dry-run   # Preview calculations without saving
 *   node backend/scripts/redistribute_pair_and_pmi.js --live      # Execute live redistribution
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const pool = require('../db');
const {
  recomputeMemberCounts,
  runDailyPairForUser,
  triggerPMIChain,
} = require('../services/incomeEngine');
const { reconcileFinances } = require('./reconcile_all_finances');

async function redistributePairAndPMI(isDryRun = true) {
  const client = await pool.connect();
  try {
    console.log('═══════════════════════════════════════════════════════════════════════════');
    console.log('🔄  PAIR INCOME & PMI FAMILY BONUS REDISTRIBUTION ENGINE');
    console.log(isDryRun ? '🔍  MODE: DRY RUN (Preview only — NO changes will be saved)' : '⚡  MODE: LIVE REDISTRIBUTION (Database will be updated & reconciled)');
    console.log('═══════════════════════════════════════════════════════════════════════════\n');

    await client.query('BEGIN');

    // ── 1. AUDIT CURRENT STATE BEFORE RESET ────────────────────────────────────
    console.log('📊 Step 1: Current Database State (Before Reset):');
    const oldPairRes = await client.query(`
      SELECT income_type, COUNT(*) AS count, COALESCE(SUM(amount), 0) AS total_amt, COALESCE(SUM(net_amount), 0) AS total_net
      FROM transactions
      WHERE income_type IN ('pair_income', 'pmi_family_bonus', 'milestone_commission')
      GROUP BY income_type
    `);
    const oldStats = {};
    oldPairRes.rows.forEach(r => { oldStats[r.income_type] = { count: parseInt(r.count), amt: parseFloat(r.total_net) }; });

    console.log(`   - Current Pair Income       : ${oldStats['pair_income']?.count || 0} txns, ₹${(oldStats['pair_income']?.amt || 0).toLocaleString('en-IN')}`);
    console.log(`   - Current PMI Family Bonus  : ${oldStats['pmi_family_bonus']?.count || 0} txns, ₹${(oldStats['pmi_family_bonus']?.amt || 0).toLocaleString('en-IN')}`);
    console.log(`   - Current Milestone Bonus   : ${oldStats['milestone_commission']?.count || 0} txns, ₹${(oldStats['milestone_commission']?.amt || 0).toLocaleString('en-IN')}`);

    // ── 2. WIPE OUT OLD PAIR, PMI & MILESTONE TRANSACTIONS ──────────────────────
    console.log('\n🧹 Step 2: Clearing old pair income, PMI bonus & daily logs...');
    const delTx = await client.query(`
      DELETE FROM transactions
      WHERE income_type IN ('pair_income', 'pmi_family_bonus', 'milestone_commission')
    `);
    console.log(`   ✓ Deleted ${delTx.rowCount} old transactions`);

    const delLogs = await client.query(`DELETE FROM daily_pair_log`);
    console.log(`   ✓ Deleted ${delLogs.rowCount} old daily pair log entries`);

    // Clean up mega_ledger entries if table exists
    try {
      const delLedger = await client.query(`
        DELETE FROM mega_ledger
        WHERE category IN ('pair_income', 'pmi_family_bonus', 'pmi_company_margin')
      `);
      console.log(`   ✓ Deleted ${delLedger.rowCount} old mega ledger allocation entries`);
    } catch (e) {
      // Table may not exist or have different structure
    }

    // Reset user pair counters
    await client.query(`
      UPDATE users
      SET total_pairs = 0,
          milestone_triggered = false
    `);
    console.log('   ✓ Reset total_pairs to 0 and milestone_triggered to false on all users');

    // ── 3. RECOMPUTE MEMBER COUNTS FROM ACTUAL BINARY TREE ─────────────────────
    console.log('\n🌲 Step 3: Recomputing subtree member counts fresh from tree structure...');
    await recomputeMemberCounts(client);

    // ── 4. RUN UPDATED PAIR MATCHING & RECORD RESULTS ──────────────────────────
    console.log('\n⚙️  Step 4: Running Pair Matching with updated logic...');
    const logDate = new Date().toISOString().split('T')[0];
    const usersRes = await client.query(`
      SELECT id, member_id, name, left_member_count, right_member_count, sponsor_id
      FROM users
      WHERE role='user' AND is_active=true
      ORDER BY id
    `);

    const pairResults = [];
    const usersWithPairIncome = [];

    for (const u of usersRes.rows) {
      const leftBefore = parseInt(u.left_member_count) || 0;
      const rightBefore = parseInt(u.right_member_count) || 0;

      if (leftBefore > 0 && rightBefore > 0) {
        const pairIncome = await runDailyPairForUser(client, u.id, logDate);

        // Check updated state
        const updatedRes = await client.query(`
          SELECT left_member_count, right_member_count, total_pairs, milestone_triggered
          FROM users WHERE id=$1
        `, [u.id]);
        const updated = updatedRes.rows[0];

        const pairsMatched = Math.round(pairIncome / 1000);
        pairResults.push({
          member_id: u.member_id,
          name: u.name,
          left_start: leftBefore,
          right_start: rightBefore,
          pairs_matched: pairsMatched,
          pair_income: pairIncome,
          milestone: updated.milestone_triggered ? '🏆 YES (+₹10k)' : 'No',
          left_rem: updated.left_member_count,
          right_rem: updated.right_member_count,
        });

        if (pairIncome > 0) {
          usersWithPairIncome.push({
            userId: u.id,
            name: u.name,
            pairIncome,
            sponsorId: u.sponsor_id,
          });
        }
      }
    }

    console.log('\n📋 Pair Income Distribution Table:');
    console.table(pairResults);

    // ── 5. RUN PMI CASCADE FOR USERS WITH PAIR INCOME ──────────────────────────
    console.log(`\n🌊 Step 5: Running PMI Family Bonus 20% cascade for ${usersWithPairIncome.length} qualifying members...`);
    for (const item of usersWithPairIncome) {
      if (item.sponsorId) {
        await triggerPMIChain(client, item.userId, item.name, item.pairIncome, item.sponsorId);
      }
    }

    // Fetch new PMI breakdown
    const pmiTxRes = await client.query(`
      SELECT 
        t.id,
        u.member_id AS sponsor_member_id,
        u.name AS sponsor_name,
        su.member_id AS source_member_id,
        su.name AS source_name,
        t.net_amount AS commission,
        t.attributed_to,
        t.description
      FROM transactions t
      JOIN users u ON t.user_id = u.id
      LEFT JOIN users su ON t.related_user_id = su.id
      WHERE t.income_type = 'pmi_family_bonus'
      ORDER BY t.id
    `);

    console.log('\n🤝 PMI Family Bonus Distributed:');
    console.table(pmiTxRes.rows.map(r => ({
      'Sponsor': `${r.sponsor_name} (${r.sponsor_member_id})`,
      'From': `${r.source_name} (${r.source_member_id})`,
      'Commission': `₹${parseFloat(r.commission).toLocaleString('en-IN')}`,
      'Type': r.attributed_to,
      'Description': r.description
    })));

    // ── 6. SUMMARY COMPARISON ──────────────────────────────────────────────────
    const newTxRes = await client.query(`
      SELECT income_type, COUNT(*) AS count, COALESCE(SUM(net_amount), 0) AS total_net
      FROM transactions
      WHERE income_type IN ('pair_income', 'pmi_family_bonus', 'milestone_commission')
      GROUP BY income_type
    `);
    const newStats = {};
    newTxRes.rows.forEach(r => { newStats[r.income_type] = { count: parseInt(r.count), amt: parseFloat(r.total_net) }; });

    console.log('\n═══════════════════════════════════════════════════════════════════════════');
    console.log('📈  BEFORE vs AFTER REDISTRIBUTION COMPARISON');
    console.log('═══════════════════════════════════════════════════════════════════════════');
    console.log('Income Type          | Old Txns (Amount)          | New Txns (Amount)          | Difference');
    console.log('─────────────────────┼────────────────────────────┼────────────────────────────┼───────────');

    const types = ['pair_income', 'pmi_family_bonus', 'milestone_commission'];
    let oldGrand = 0;
    let newGrand = 0;

    for (const t of types) {
      const oCount = oldStats[t]?.count || 0;
      const oAmt   = oldStats[t]?.amt || 0;
      const nCount = newStats[t]?.count || 0;
      const nAmt   = newStats[t]?.amt || 0;
      const diff   = nAmt - oAmt;
      oldGrand += oAmt;
      newGrand += nAmt;

      const oStr = `${oCount} (₹${oAmt.toLocaleString('en-IN')})`.padEnd(26);
      const nStr = `${nCount} (₹${nAmt.toLocaleString('en-IN')})`.padEnd(26);
      const dStr = `${diff >= 0 ? '+' : ''}₹${diff.toLocaleString('en-IN')}`;
      console.log(`${t.padEnd(20)} | ${oStr} | ${nStr} | ${dStr}`);
    }
    console.log('─────────────────────┼────────────────────────────┼────────────────────────────┼───────────');
    console.log(`${'TOTAL DISTRIBUTED'.padEnd(20)} | ₹${oldGrand.toLocaleString('en-IN').padEnd(24)} | ₹${newGrand.toLocaleString('en-IN').padEnd(24)} | ${newGrand - oldGrand >= 0 ? '+' : ''}₹${(newGrand - oldGrand).toLocaleString('en-IN')}`);
    console.log('═══════════════════════════════════════════════════════════════════════════\n');

    // ── 7. RECONCILIATION ──────────────────────────────────────────────────────
    console.log('⚖️  Step 6: Executing Full Mathematical Reconciliation...');
    if (isDryRun) {
      console.log('🔍 In DRY-RUN mode: Rolling back all test operations. The database remains unchanged.');
      await client.query('ROLLBACK');
      console.log('\n💡 To apply these changes permanently, run:');
      console.log('   node backend/scripts/redistribute_pair_and_pmi.js --live\n');
    } else {
      await client.query('COMMIT');
      console.log('✅ Changes committed to database!');

      // Run live reconciliation
      console.log('\n⚡ Running live financial reconciliation across all sub-ledgers...');
      await reconcileFinances(pool, false);
      console.log('\n🎉 ALL DONE! Pair income and PMI redistributed and all wallets reconciled.');
    }

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Error during redistribution:', err);
    throw err;
  } finally {
    client.release();
  }
}

if (require.main === module) {
  const isLive = process.argv.includes('--live');
  const isDryRun = !isLive || process.argv.includes('--dry-run');

  redistributePairAndPMI(isDryRun)
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

module.exports = { redistributePairAndPMI };

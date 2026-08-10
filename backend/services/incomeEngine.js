/**
 * Income Engine v2 — PV-based binary MLM system
 *
 * Key rules:
 * - ₹12,500 deposit = 1 PV. Activation adds 1 PV up the entire ancestor chain.
 * - Daily pair matching: min(left_pv, right_pv), capped at 10 pairs/day
 * - Weaker leg is FULLY FLUSHED to 0 (discarded / grey)
 * - Stronger leg carries forward ONLY the excess beyond the cap
 *   Example: L=12, R=15 → 10 pairs paid. L(weaker)→0 flushed. R(stronger)→5 carry.
 * - Milestone: When total_pairs reaches 10 → ₹10,000 Milestone Bonus (one-time)
 * - SMI Family Bonus: triggers on milestone achievement (10 total pairs)
 *   → 20% of ₹10,000 cascade up sponsor chain until <₹1 → remainder to company
 * - Referral income: ₹2,000 one-time, flat, no cascade
 */

const pool = require('../db');

const ACTIVATION_THRESHOLD = 12500;
const PV_PER_DEPOSIT       = 1;         // 1 PV per ₹12,500
const PAIR_INCOME_PER_PAIR = 1000;      // ₹1,000 per pair matched
const DAILY_PAIR_CAP       = 10;        // max pairs per day
const DAILY_MAX_INCOME     = 10000;     // 10 × ₹1,000
const REFERRAL_INCOME      = 2000;      // ₹2,000 flat one-time
const MILESTONE_BONUS      = 10000;     // ₹10,000 one-time at 10 total pairs
const SMI_RATE             = 0.20;      // 20% per level up sponsor chain
const SMI_MIN_AMOUNT       = 1;         // stop cascade below ₹1

// ── HELPERS ─────────────────────────────────────────────────────────────────

async function getAdminId(client) {
  const r = await client.query(`SELECT id FROM users WHERE role='admin' LIMIT 1`);
  return r.rows[0]?.id || null;
}

/**
 * Credit or pend income for a user based on active status.
 * Automatically applies TDS (currently 0% — update when rate confirmed).
 */
async function creditIncome(client, userId, incomeType, amount, description, relatedUserId = null) {
  if (amount < SMI_MIN_AMOUNT) return;

  const userRes = await client.query('SELECT is_active, role FROM users WHERE id=$1', [userId]);
  const user = userRes.rows[0];
  if (!user) return;

  const tdsRate   = 0;
  const tdsAmount = parseFloat((amount * tdsRate / 100).toFixed(2));
  const netAmount = parseFloat((amount - tdsAmount).toFixed(2));
  // Referral & pair income are credited directly upon deposit approval
  const status = (user.is_active || incomeType === 'referral_income' || incomeType === 'pair_income') ? 'credited' : 'pending';

  await client.query(
    `INSERT INTO transactions (user_id,income_type,amount,tds_rate,tds_amount,net_amount,description,status,related_user_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [userId, incomeType, amount, tdsRate, tdsAmount, netAmount, description, status, relatedUserId]
  );

  const col = user.is_active ? 'wallet_balance' : 'pending_balance';
  await client.query(`UPDATE users SET ${col}=${col}+$1, updated_at=NOW() WHERE id=$2`, [netAmount, userId]);

  // Deduct from Company Admin wallet if member is getting credited income
  if (user.role !== 'admin' && status === 'credited') {
    const adminId = await getAdminId(client);
    if (adminId) {
      await client.query(`UPDATE users SET wallet_balance=wallet_balance-$1, updated_at=NOW() WHERE id=$2`, [netAmount, adminId]);
    }
  }
}

// ── PV PROPAGATION ───────────────────────────────────────────────────────────

/**
 * When user X activates, walk up the entire ancestor chain and
 * add 1 PV to each ancestor's left_pv or right_pv depending on which
 * subtree X belongs to.
 */
async function propagatePV(client, activatedUserId) {
  let nodeRes = await client.query('SELECT id, parent_id, position FROM users WHERE id=$1', [activatedUserId]);
  let node = nodeRes.rows[0];
  const logDate = new Date().toISOString().split('T')[0];

  while (node && node.parent_id) {
    const pvCol = node.position === 'left' ? 'left_pv' : 'right_pv';
    await client.query(
      `UPDATE users SET ${pvCol}=${pvCol}+$1, updated_at=NOW() WHERE id=$2`,
      [PV_PER_DEPOSIT, node.parent_id]
    );

    // Calculate & credit pair income immediately for ancestor if pair is formed
    await runDailyPairForUser(client, node.parent_id, logDate);

    nodeRes = await client.query('SELECT id, parent_id, position FROM users WHERE id=$1', [node.parent_id]);
    node = nodeRes.rows[0];
  }
}

// ── DAILY PAIR MATCHING ───────────────────────────────────────────────────────

/**
 * Run daily pair matching for a single user.
 *
 * Logic (Example: Left=12, Right=15, Cap=10):
 *   rawPairs = min(12, 15) = 12
 *   paidPairs = min(12, 10) = 10   → ₹10,000 pair income
 *   Weaker leg (Left=12):  FULLY flushed to 0.  The 2 remaining are DISCARDED.
 *   Stronger leg (Right=15): 15 - 10 = 5 carry forward for tomorrow.
 *
 * Milestone: When user's total_pairs reaches 10 → ₹10,000 bonus + SMI cascade.
 */
async function runDailyPairForUser(client, userId, logDate) {
  const userRes = await client.query(
    'SELECT id, name, left_pv, right_pv, sponsor_id, is_active, total_pairs, milestone_triggered FROM users WHERE id=$1 FOR UPDATE',
    [userId]
  );
  const user = userRes.rows[0];
  if (!user || !user.is_active) return;

  const leftPV  = parseFloat(user.left_pv)  || 0;
  const rightPV = parseFloat(user.right_pv) || 0;

  if (leftPV === 0 || rightPV === 0) {
    return;
  }

  // Check how many pairs user has ALREADY matched today (Max 10 pairs/day cap)
  const todayLogRes = await client.query(
    'SELECT COALESCE(SUM(pairs_matched), 0) AS today_pairs FROM daily_pair_log WHERE user_id=$1 AND log_date=$2',
    [userId, logDate]
  );
  const todayPairsMatched = parseInt(todayLogRes.rows[0]?.today_pairs || 0);
  const remainingDailyCap = Math.max(0, DAILY_PAIR_CAP - todayPairsMatched);

  if (remainingDailyCap === 0) {
    return; // Daily 10-pair cap reached for today
  }

  const rawPairs   = Math.min(leftPV, rightPV);
  const paidPairs  = Math.min(rawPairs, remainingDailyCap);
  const amountPaid = paidPairs * PAIR_INCOME_PER_PAIR;

  if (paidPairs <= 0) return;

  // ── Stronger / Weaker Leg Carry-Forward vs Flush Rules ──
  // Weaker leg: knocked off / flushed to 0
  // Stronger leg: excess PV carries forward to next capping period
  const leftIsStronger = leftPV >= rightPV;

  // Stronger leg carry forward:
  const leftCarry  = leftIsStronger  ? parseFloat((leftPV  - paidPairs).toFixed(2)) : 0;
  const rightCarry = !leftIsStronger ? parseFloat((rightPV - paidPairs).toFixed(2)) : 0;

  // Weaker leg flushed (knocked off):
  const leftFlush  = !leftIsStronger ? leftPV : 0;
  const rightFlush = leftIsStronger  ? rightPV : 0;

  // Update user PV balances
  await client.query(
    `UPDATE users SET left_pv=$1, right_pv=$2, total_pairs=total_pairs+$3, updated_at=NOW() WHERE id=$4`,
    [leftCarry, rightCarry, paidPairs, userId]
  );

  // Credit pair income (₹1,000 per pair up to 10 pairs/day)
  const desc = `Daily pair match: ${paidPairs} pair${paidPairs > 1 ? 's' : ''} on ${logDate} (Capped at 10/day)`;
  await creditIncome(client, userId, 'pair_income', amountPaid, desc, null);

  // ── Milestone Check: 10 total pairs = ₹10,000 bonus + SMI cascade ──
  const newTotalPairs = parseInt(user.total_pairs) + paidPairs;
  if (newTotalPairs >= 10 && !user.milestone_triggered) {
    await client.query('UPDATE users SET milestone_triggered=true WHERE id=$1', [userId]);
    await creditIncome(client, userId, 'milestone_commission', MILESTONE_BONUS, '🏆 Milestone Bonus: 10 Pairs Reached!', null);
    await triggerSMIChain(client, userId, user.name, MILESTONE_BONUS, user.sponsor_id);
  }

  // Log to daily_pair_log
  const milestoneHit = (newTotalPairs >= 10 && !user.milestone_triggered);
  await client.query(
    `INSERT INTO daily_pair_log
       (user_id,log_date,left_pv_start,right_pv_start,pairs_matched,amount_paid,
        left_pv_carry,right_pv_carry,left_pv_flushed,right_pv_flushed,smi_triggered)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     ON CONFLICT (user_id,log_date) DO UPDATE SET
       pairs_matched = daily_pair_log.pairs_matched + EXCLUDED.pairs_matched,
       amount_paid = daily_pair_log.amount_paid + EXCLUDED.amount_paid,
       left_pv_carry = EXCLUDED.left_pv_carry,
       right_pv_carry = EXCLUDED.right_pv_carry,
       left_pv_flushed = daily_pair_log.left_pv_flushed + EXCLUDED.left_pv_flushed,
       right_pv_flushed = daily_pair_log.right_pv_flushed + EXCLUDED.right_pv_flushed`,
    [userId, logDate, leftPV, rightPV, paidPairs, amountPaid,
     leftCarry, rightCarry, leftFlush, rightFlush, milestoneHit]
  );
}

/**
 * Run daily pair matching for ALL users.
 * Called at midnight by cron job.
 */
async function runDailyPairJob() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const logDate = new Date().toISOString().split('T')[0];
    const usersRes = await client.query(`SELECT id FROM users WHERE role='user' AND is_active=true`);
    for (const row of usersRes.rows) {
      await runDailyPairForUser(client, row.id, logDate);
    }
    await client.query('COMMIT');
    console.log(`✅ Daily pair job done for ${logDate} — ${usersRes.rows.length} users processed`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Daily pair job failed:', err.message);
  } finally {
    client.release();
  }
}

// ── SMI FAMILY BONUS CASCADE ─────────────────────────────────────────────────

/**
 * Cascade 20% of baseAmount up the sponsor chain.
 * Each level receives 20% of the previous level's commission.
 * Rules:
 *   - Only paid to member users (role='user').
 *   - When chain reaches Company / Admin (role='admin'), STOP execution immediately.
 *   - No transactions created for Company receiving its own money back.
 */
async function triggerSMIChain(client, sourceUserId, sourceName, baseAmount, startSponsorId) {
  let commission = parseFloat((baseAmount * SMI_RATE).toFixed(2));
  let sponsorId  = startSponsorId;
  let level      = 1;

  while (commission >= SMI_MIN_AMOUNT && sponsorId) {
    const sponsorRes = await client.query('SELECT id, name, role, sponsor_id FROM users WHERE id=$1', [sponsorId]);
    const sponsor = sponsorRes.rows[0];

    // If sponsor does not exist or is Company/Admin → STOP cascade immediately (no transaction logged)
    if (!sponsor || sponsor.role === 'admin') {
      break;
    }

    const desc = `SMI Family Bonus: 20% from ${sourceName}'s network (level ${level})`;
    await creditIncome(client, sponsor.id, 'smi_family_bonus', Math.floor(commission), desc, sourceUserId);

    // Get next sponsor up
    sponsorId  = sponsor.sponsor_id;
    commission = parseFloat((commission * SMI_RATE).toFixed(2));
    level++;
  }
}

// ── REFERRAL INCOME ──────────────────────────────────────────────────────────

async function processReferralIncome(client, referrerId, newUserName) {
  const desc = `Referral income: ${newUserName} joined using your referral code`;
  await creditIncome(client, referrerId, 'referral_income', REFERRAL_INCOME, desc, null);
}

// ── ACTIVATION ───────────────────────────────────────────────────────────────

/**
 * Check if user hits ₹12,500 threshold → activate, release pending income,
 * propagate 1 PV up ancestor chain, recalculate rank.
 */
async function checkAndActivateUser(client, userId) {
  const res = await client.query(
    'SELECT name, total_deposited, is_active, pending_balance, sponsor_id FROM users WHERE id=$1', [userId]
  );
  const user = res.rows[0];
  if (!user || user.is_active) return false;

  if (parseFloat(user.total_deposited) >= ACTIVATION_THRESHOLD) {
    const pending = parseFloat(user.pending_balance) || 0;
    await client.query(
      `UPDATE users SET is_active=true, wallet_balance=wallet_balance+$1, pending_balance=0, updated_at=NOW() WHERE id=$2`,
      [pending, userId]
    );
    await client.query(
      `UPDATE transactions SET status='credited' WHERE user_id=$1 AND status='pending'`, [userId]
    );

    // Process referral income for sponsor
    if (user.sponsor_id) {
      await processReferralIncome(client, user.sponsor_id, user.name);
    }

    // Add 1 PV up the ancestor chain and process pair matching
    await propagatePV(client, userId);

    // Recalculate rank for the newly activated user and their ancestors
    await recalculateRankChain(client, userId);

    return true;
  }
  return false;
}

// ── RANK CALCULATION ─────────────────────────────────────────────────────────

/**
 * Count direct AM referrals for non-working income.
 * Count all AMs in full subtree for rank promotion.
 */
async function countAMsInSubtree(client, userId) {
  const res = await client.query(`
    WITH RECURSIVE subtree AS (
      SELECT id, current_rank FROM users WHERE id=$1
      UNION ALL
      SELECT u.id, u.current_rank FROM users u
      INNER JOIN subtree s ON u.parent_id=s.id
    )
    SELECT COUNT(*) AS cnt FROM subtree WHERE current_rank='AM' AND id<>$1
  `, [userId]);
  return parseInt(res.rows[0]?.cnt) || 0;
}

async function recalculateRank(client, userId) {
  const amCount = await countAMsInSubtree(client, userId);
  const ranksRes = await client.query(
    `SELECT code FROM ranks WHERE req_type='am_count' AND req_value<=$1 ORDER BY sort_order DESC LIMIT 1`,
    [amCount]
  );

  const newRank = ranksRes.rows[0]?.code || 'SA';
  const userRes = await client.query('SELECT current_rank FROM users WHERE id=$1', [userId]);
  const oldRank = userRes.rows[0]?.current_rank;

  if (newRank !== oldRank) {
    await client.query(
      `UPDATE users SET current_rank=$1, rank_updated_at=NOW() WHERE id=$2`,
      [newRank, userId]
    );
    return { promoted: true, oldRank, newRank };
  }
  return { promoted: false };
}

async function recalculateRankChain(client, userId) {
  // Recalculate for the user and all ancestors
  let nodeRes = await client.query('SELECT id, parent_id FROM users WHERE id=$1', [userId]);
  let node = nodeRes.rows[0];
  while (node) {
    await recalculateRank(client, node.id);
    if (!node.parent_id) break;
    nodeRes = await client.query('SELECT id, parent_id FROM users WHERE id=$1', [node.parent_id]);
    node = nodeRes.rows[0];
  }
}

// ── NON-WORKING INCOME ────────────────────────────────────────────────────────

const NON_WORKING_MILESTONES = [
  { am_count: 6,   amount: 250000  },
  { am_count: 12,  amount: 500000  },
  { am_count: 24,  amount: 1000000 },
  { am_count: 48,  amount: 2000000 },
  { am_count: 100, amount: 4500000 },
  { am_count: 250, amount: 10000000},
];

async function checkNonWorkingIncome(client, userId) {
  // TODO (Q6 = recurring): determine recurrence frequency with papa
  // For now: one-time per milestone level (prevents duplicates via log)
  const directAMRes = await client.query(
    `SELECT COUNT(*) AS cnt FROM users WHERE sponsor_id=$1 AND current_rank='AM'`, [userId]
  );
  const directAMs = parseInt(directAMRes.rows[0]?.cnt) || 0;

  for (const milestone of NON_WORKING_MILESTONES) {
    if (directAMs >= milestone.am_count) {
      const existing = await client.query(
        `SELECT id FROM non_working_income_log WHERE user_id=$1 AND am_count=$2 AND status='credited'`,
        [userId, milestone.am_count]
      );
      if (!existing.rows.length) {
        await creditIncome(client, userId, 'non_working_income', milestone.amount,
          `Non-Working Income milestone: ${milestone.am_count} direct AMs`, null);
        await client.query(
          `INSERT INTO non_working_income_log (user_id, am_count, amount, status) VALUES ($1,$2,$3,'credited')`,
          [userId, milestone.am_count, milestone.amount]
        );
      }
    }
  }
}

module.exports = {
  propagatePV,
  runDailyPairJob,
  runDailyPairForUser,
  triggerSMIChain,
  processReferralIncome,
  checkAndActivateUser,
  recalculateRank,
  recalculateRankChain,
  checkNonWorkingIncome,
  creditIncome,
  ACTIVATION_THRESHOLD,
  DAILY_PAIR_CAP,
  DAILY_MAX_INCOME,
  REFERRAL_INCOME,
};

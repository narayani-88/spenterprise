/**
 * Income Engine v3 — Three-Tier Account System
 *
 * Money Flow:
 *   1. Every rupee enters the MEGA_ACCOUNT first (deposit approval)
 *   2. When income is earned, it's tagged to either:
 *      - USER_PAYABLE wallet (if earning ID is REAL_USER) → full gross amount, no TDS
 *      - COMPANY_EARNED wallet (if earning ID is COMPANY_PLACED) → company profit
 *   3. TDS (5%) + NWI (10%) are deducted ONLY at withdrawal time
 *   4. Mega Account balance = Σ User Wallets + Company Earned + already withdrawn
 *
 * Key rules:
 *   - ₹12,500 deposit = 1 PV. Activation adds 1 PV up the entire ancestor chain.
 *   - Daily pair matching: min(left_pv, right_pv), capped at 10 pairs/day
 *   - Weaker leg FULLY FLUSHED, stronger leg carries forward excess
 *   - Attribution follows the EARNING ID's source_type, not the children's
 */

const pool = require('../db');

const ACTIVATION_THRESHOLD = 12500;
const PV_PER_DEPOSIT       = 1;
const PAIR_INCOME_PER_PAIR = 1000;
const DAILY_PAIR_CAP       = 10;
const DAILY_MAX_INCOME     = 10000;
const REFERRAL_INCOME      = 2000;
const MILESTONE_BONUS      = 10000;
const SMI_RATE             = 0.20;
const SMI_MIN_AMOUNT       = 1;

// Financial Policy Parameters:
// TDS_RATE: Standard 5% Statutory Tax Deduction applied at cash withdrawal.
// WITHHOLD_NWI_AT_WITHDRAWAL: Set to TRUE. 5% TDS + 10% NWI (S.A.C.F. Retention Pool) withheld at payout -> 85% Net Payout.
const TDS_RATE                   = 5;    // 5% Statutory TDS
const WITHHOLD_NWI_AT_WITHDRAWAL = true; // 10% NWI Withheld at payout (Net payout = 85%)
const NWI_RATE                   = WITHHOLD_NWI_AT_WITHDRAWAL ? 10 : 0;

// ── WALLET & LEDGER HELPERS ─────────────────────────────────────────────────

async function getAdminId(client) {
  const r = await client.query(`SELECT id FROM users WHERE role='admin' LIMIT 1`);
  return r.rows[0]?.id || null;
}

/**
 * Get or lazily create a wallet row.
 * @param {string} walletType - 'USER_PAYABLE', 'COMPANY_EARNED', or 'MEGA_ACCOUNT'
 * @param {number|null} ownerId - user id for USER_PAYABLE, null for company wallets
 */
async function getOrCreateWallet(client, ownerId, walletType) {
  const existing = ownerId
    ? await client.query('SELECT * FROM wallets WHERE owner_id=$1 AND wallet_type=$2', [ownerId, walletType])
    : await client.query('SELECT * FROM wallets WHERE owner_id IS NULL AND wallet_type=$1', [walletType]);

  if (existing.rows.length) return existing.rows[0];

  const inserted = ownerId
    ? await client.query('INSERT INTO wallets (owner_id, wallet_type) VALUES ($1,$2) ON CONFLICT (owner_id, wallet_type) DO UPDATE SET updated_at=NOW() RETURNING *', [ownerId, walletType])
    : await client.query('INSERT INTO wallets (owner_id, wallet_type) VALUES (NULL,$1) ON CONFLICT (owner_id, wallet_type) DO UPDATE SET updated_at=NOW() RETURNING *', [walletType]);

  return inserted.rows[0];
}

/** Append-only insert into mega_ledger — NEVER update or delete */
async function recordMegaLedger(client, transactionType, category, amount, walletId, userId, description) {
  await client.query(
    `INSERT INTO mega_ledger (transaction_type, category, amount, related_wallet_id, related_user_id, description)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [transactionType, category, amount, walletId, userId, description]
  );
}

// ── CREDIT INCOME (source_type routing) ─────────────────────────────────────

/**
 * Credit income to the correct sub-ledger based on earning ID's source_type.
 *
 * - REAL_USER → credited at FULL GROSS to user's wallet (no TDS at earn time)
 * - COMPANY_PLACED → credited to Company Earned Account (non-withdrawable)
 *
 * TDS and NWI are deducted ONLY when user requests withdrawal.
 */
async function creditIncome(client, userId, incomeType, amount, description, relatedUserId = null) {
  if (amount < SMI_MIN_AMOUNT) return;

  const userRes = await client.query(
    'SELECT is_active, role, source_type FROM users WHERE id=$1', [userId]
  );
  const user = userRes.rows[0];
  if (!user) return;

  const sourceType = user.source_type || 'REAL_USER';
  // No TDS at earn time — full gross credited. TDS + NWI applied at withdrawal.
  const netAmount = parseFloat(amount.toFixed(2));

  if (sourceType === 'COMPANY_PLACED' || user.role === 'admin') {
    // ── Route to Company Earned Account ──
    const companyWallet = await getOrCreateWallet(client, null, 'COMPANY_EARNED');
    await client.query('UPDATE wallets SET balance=balance+$1, updated_at=NOW() WHERE id=$2', [netAmount, companyWallet.id]);

    // Debit Mega Account (unallocated reserve) so Mega Account = Total Deposits - Company Earned - User Liabilities
    const megaWallet = await getOrCreateWallet(client, null, 'MEGA_ACCOUNT');
    await client.query('UPDATE wallets SET balance=balance-$1, updated_at=NOW() WHERE id=$2', [netAmount, megaWallet.id]);

    // Log in transactions for audit trail (attributed_to = COMPANY_PLACED)
    await client.query(
      `INSERT INTO transactions (user_id,income_type,amount,tds_rate,tds_amount,net_amount,description,status,related_user_id,attributed_to)
       VALUES ($1,$2,$3,0,0,$4,$5,'credited',$6,'COMPANY_PLACED')`,
      [userId, incomeType, amount, netAmount, description, relatedUserId]
    );

    await recordMegaLedger(client, 'INTERNAL_ALLOCATION', incomeType, netAmount,
      companyWallet.id, userId, `[COMPANY] ${description}`);
    return;
  }

  // ── Route to Real User's Wallet ──
  const status = (user.is_active || incomeType === 'referral_income' || incomeType === 'pair_income')
    ? 'credited' : 'pending';

  await client.query(
    `INSERT INTO transactions (user_id,income_type,amount,tds_rate,tds_amount,net_amount,description,status,related_user_id,attributed_to)
     VALUES ($1,$2,$3,0,0,$4,$5,$6,$7,'REAL_USER')`,
    [userId, incomeType, amount, netAmount, description, status, relatedUserId]
  );

  // Update user's wallet/pending balance
  const col = user.is_active ? 'wallet_balance' : 'pending_balance';
  await client.query(`UPDATE users SET ${col}=${col}+$1, updated_at=NOW() WHERE id=$2`, [netAmount, userId]);

  // Update USER_PAYABLE wallet & Debit Mega Account (unallocated reserve)
  if (status === 'credited') {
    const userWallet = await getOrCreateWallet(client, userId, 'USER_PAYABLE');
    await client.query('UPDATE wallets SET balance=balance+$1, updated_at=NOW() WHERE id=$2', [netAmount, userWallet.id]);

    const megaWallet = await getOrCreateWallet(client, null, 'MEGA_ACCOUNT');
    await client.query('UPDATE wallets SET balance=balance-$1, updated_at=NOW() WHERE id=$2', [netAmount, megaWallet.id]);

    await recordMegaLedger(client, 'INTERNAL_ALLOCATION', incomeType, netAmount,
      userWallet.id, userId, description);
  }
}

// ── DEPOSIT → MEGA ACCOUNT INFLOW ───────────────────────────────────────────

/**
 * Record a deposit inflow into the Mega Account.
 * Called when admin approves a deposit.
 */
async function recordDepositInflow(client, userId, amount, description) {
  const megaWallet = await getOrCreateWallet(client, null, 'MEGA_ACCOUNT');
  await client.query('UPDATE wallets SET balance=balance+$1, updated_at=NOW() WHERE id=$2', [amount, megaWallet.id]);
  await recordMegaLedger(client, 'INFLOW', 'deposit', amount, megaWallet.id, userId, description);
}

// ── WITHDRAWAL PROCESSING ───────────────────────────────────────────────────

/**
 * Process an approved withdrawal request.
 * Deducts 5% statutory TDS. (NWI is default 0% on withdrawal as NWI/S.A.C.F is an income pool).
 * Net payout (95%) is what the user actually receives via bank transfer.
 */
async function processWithdrawal(client, withdrawalId, approvedById) {
  const wRes = await client.query('SELECT * FROM withdrawal_requests WHERE id=$1 FOR UPDATE', [withdrawalId]);
  const wr = wRes.rows[0];
  if (!wr || wr.status !== 'pending') throw new Error('Withdrawal not found or already processed');

  const userRes = await client.query('SELECT id, name, member_id, wallet_balance FROM users WHERE id=$1 FOR UPDATE', [wr.user_id]);
  const user = userRes.rows[0];
  if (!user) throw new Error('User not found');

  const gross = parseFloat(wr.requested_amount);
  if (parseFloat(user.wallet_balance) < gross) {
    throw new Error(`Insufficient balance. Wallet: ₹${user.wallet_balance}, Requested: ₹${gross}`);
  }

  const tdsAmount = parseFloat((gross * TDS_RATE / 100).toFixed(2));
  const nwiAmount = parseFloat((gross * NWI_RATE / 100).toFixed(2));
  const netAmount = parseFloat((gross - tdsAmount - nwiAmount).toFixed(2));

  // 1. Deduct gross from user's wallet_balance
  await client.query('UPDATE users SET wallet_balance=wallet_balance-$1, updated_at=NOW() WHERE id=$2', [gross, wr.user_id]);

  // 2. Deduct full gross from USER_PAYABLE wallet
  const userWallet = await getOrCreateWallet(client, wr.user_id, 'USER_PAYABLE');
  await client.query('UPDATE wallets SET balance=balance-$1, updated_at=NOW() WHERE id=$2', [gross, userWallet.id]);

  // 3. Credit 5% TDS to TDS_PAYABLE wallet (Government tax liability)
  const tdsWallet = await getOrCreateWallet(client, null, 'TDS_PAYABLE');
  if (tdsAmount > 0) {
    await client.query('UPDATE wallets SET balance=balance+$1, updated_at=NOW() WHERE id=$2', [tdsAmount, tdsWallet.id]);
  }

  // 4. Credit 10% NWF to NWF_POOL wallet (Retention pool)
  const nwfWallet = await getOrCreateWallet(client, null, 'NWF_POOL');
  if (nwiAmount > 0) {
    await client.query('UPDATE wallets SET balance=balance+$1, updated_at=NOW() WHERE id=$2', [nwiAmount, nwfWallet.id]);
  }

  // 5. Deduct net 85% payout from MEGA_ACCOUNT (actual cash leaving company treasury)
  const megaWallet = await getOrCreateWallet(client, null, 'MEGA_ACCOUNT');
  await client.query('UPDATE wallets SET balance=balance-$1, updated_at=NOW() WHERE id=$2', [netAmount, megaWallet.id]);

  // NOTE: COMPANY_EARNED IS NEVER TOUCHED BY A WITHDRAWAL!
  // It represents ONLY profit earned by COMPANY_PLACED IDs in the binary/referral tree.

  // 6. Update withdrawal request
  await client.query(
    `UPDATE withdrawal_requests SET status='approved', tds_amount=$1, nwi_amount=$2, net_amount=$3,
     approved_by=$4, processed_at=NOW() WHERE id=$5`,
    [tdsAmount, nwiAmount, netAmount, approvedById, withdrawalId]
  );

  // 7. Log transactions for user history
  const desc = nwiAmount > 0
    ? `Withdrawal of ₹${gross} (Net: ₹${netAmount} after 5% TDS & 10% NWF Pool Contribution)`
    : `Withdrawal of ₹${gross} (Net: ₹${netAmount} after 5% TDS Statutory Tax)`;

  await client.query(
    `INSERT INTO transactions (user_id,income_type,amount,tds_rate,tds_amount,net_amount,description,status,attributed_to)
     VALUES ($1,'withdrawal',$2,0,0,$3,$4,'credited','REAL_USER')`,
    [wr.user_id, -gross, -gross, desc]
  );

  if (tdsAmount > 0) {
    await client.query(
      `INSERT INTO transactions (user_id,income_type,amount,net_amount,description,status,attributed_to)
       VALUES ($1,'tds_deduction',$2,$2,$3,'credited','REAL_USER')`,
      [wr.user_id, -tdsAmount, `Statutory TDS 5% on withdrawal of ₹${gross}`]
    );
  }

  if (nwiAmount > 0) {
    await client.query(
      `INSERT INTO transactions (user_id,income_type,amount,net_amount,description,status,attributed_to)
       VALUES ($1,'nwi_deduction',$2,$2,$3,'credited','REAL_USER')`,
      [wr.user_id, -nwiAmount, `NWF Pool Contribution 10% on withdrawal of ₹${gross}`]
    );
  }

  // 8. Mega Ledger entries
  await recordMegaLedger(client, 'OUTFLOW', 'withdrawal_net', netAmount, megaWallet.id, wr.user_id,
    `Withdrawal net payout to ${user.name} (${user.member_id}) — Gross: ₹${gross}, TDS: ₹${tdsAmount}, NWF: ₹${nwiAmount}, Net Paid: ₹${netAmount}`);

  if (tdsAmount > 0) {
    await recordMegaLedger(client, 'INTERNAL_ALLOCATION', 'tds_withheld', tdsAmount, tdsWallet.id, wr.user_id,
      `TDS 5% tax withheld from ${user.member_id} withdrawal (TDS_PAYABLE government liability)`);
  }
  if (nwiAmount > 0) {
    await recordMegaLedger(client, 'INTERNAL_ALLOCATION', 'nwf_withheld', nwiAmount, nwfWallet.id, wr.user_id,
      `10% NWF withheld from ${user.member_id} withdrawal (NWF_POOL retention)`);
  }

  return { gross, tdsAmount, nwiAmount, netAmount, memberName: user.name, memberId: user.member_id };
}

// ── PV PROPAGATION ───────────────────────────────────────────────────────────

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

    await runDailyPairForUser(client, node.parent_id, logDate);

    nodeRes = await client.query('SELECT id, parent_id, position FROM users WHERE id=$1', [node.parent_id]);
    node = nodeRes.rows[0];
  }
}

// ── DAILY PAIR MATCHING ───────────────────────────────────────────────────────

async function runDailyPairForUser(client, userId, logDate) {
  const userRes = await client.query(
    'SELECT id, name, left_pv, right_pv, sponsor_id, is_active, total_pairs, milestone_triggered, source_type FROM users WHERE id=$1 FOR UPDATE',
    [userId]
  );
  const user = userRes.rows[0];
  if (!user || !user.is_active) return;

  const leftPV  = parseFloat(user.left_pv)  || 0;
  const rightPV = parseFloat(user.right_pv) || 0;
  if (leftPV === 0 || rightPV === 0) return;

  const todayLogRes = await client.query(
    'SELECT COALESCE(SUM(pairs_matched), 0) AS today_pairs FROM daily_pair_log WHERE user_id=$1 AND log_date=$2',
    [userId, logDate]
  );
  const todayPairsMatched = parseInt(todayLogRes.rows[0]?.today_pairs || 0);
  const remainingDailyCap = Math.max(0, DAILY_PAIR_CAP - todayPairsMatched);
  if (remainingDailyCap === 0) return;

  const rawPairs   = Math.min(leftPV, rightPV);
  const paidPairs  = Math.min(rawPairs, remainingDailyCap);
  const amountPaid = paidPairs * PAIR_INCOME_PER_PAIR;
  if (paidPairs <= 0) return;

  const leftIsStronger = leftPV >= rightPV;
  const leftCarry  = leftIsStronger  ? parseFloat((leftPV  - paidPairs).toFixed(2)) : 0;
  const rightCarry = !leftIsStronger ? parseFloat((rightPV - paidPairs).toFixed(2)) : 0;
  const leftFlush  = !leftIsStronger ? leftPV : 0;
  const rightFlush = leftIsStronger  ? rightPV : 0;

  await client.query(
    `UPDATE users SET left_pv=$1, right_pv=$2, total_pairs=total_pairs+$3, updated_at=NOW() WHERE id=$4`,
    [leftCarry, rightCarry, paidPairs, userId]
  );

  // Credit pair income — routing decided by source_type inside creditIncome()
  const desc = `Daily pair match: ${paidPairs} pair${paidPairs > 1 ? 's' : ''} on ${logDate} (Capped at 10/day)`;
  await creditIncome(client, userId, 'pair_income', amountPaid, desc, null);

  // Milestone check
  const newTotalPairs = parseInt(user.total_pairs) + paidPairs;
  if (newTotalPairs >= 10 && !user.milestone_triggered) {
    await client.query('UPDATE users SET milestone_triggered=true WHERE id=$1', [userId]);
    await creditIncome(client, userId, 'milestone_commission', MILESTONE_BONUS, '🏆 Milestone Bonus: 10 Pairs Reached!', null);
    await triggerSMIChain(client, userId, user.name, MILESTONE_BONUS, user.sponsor_id);
  }

  // Log to daily_pair_log with attribution
  const sourceType = user.source_type || 'REAL_USER';
  const milestoneHit = (newTotalPairs >= 10 && !user.milestone_triggered);
  await client.query(
    `INSERT INTO daily_pair_log
       (user_id,log_date,left_pv_start,right_pv_start,pairs_matched,amount_paid,
        left_pv_carry,right_pv_carry,left_pv_flushed,right_pv_flushed,smi_triggered,attributed_to)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     ON CONFLICT (user_id,log_date) DO UPDATE SET
       pairs_matched = daily_pair_log.pairs_matched + EXCLUDED.pairs_matched,
       amount_paid = daily_pair_log.amount_paid + EXCLUDED.amount_paid,
       left_pv_carry = EXCLUDED.left_pv_carry,
       right_pv_carry = EXCLUDED.right_pv_carry,
       left_pv_flushed = daily_pair_log.left_pv_flushed + EXCLUDED.left_pv_flushed,
       right_pv_flushed = daily_pair_log.right_pv_flushed + EXCLUDED.right_pv_flushed`,
    [userId, logDate, leftPV, rightPV, paidPairs, amountPaid,
     leftCarry, rightCarry, leftFlush, rightFlush, milestoneHit, sourceType]
  );
}

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

async function triggerSMIChain(client, sourceUserId, sourceName, baseAmount, startSponsorId) {
  let commission = parseFloat((baseAmount * SMI_RATE).toFixed(2));
  let sponsorId  = startSponsorId;
  let level      = 1;

  while (commission >= SMI_MIN_AMOUNT && sponsorId) {
    const sponsorRes = await client.query('SELECT id, name, role, sponsor_id FROM users WHERE id=$1', [sponsorId]);
    const sponsor = sponsorRes.rows[0];
    if (!sponsor || sponsor.role === 'admin') break;

    const desc = `SMI Family Bonus: 20% from ${sourceName}'s network (level ${level})`;
    await creditIncome(client, sponsor.id, 'smi_family_bonus', Math.floor(commission), desc, sourceUserId);

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

    // Sync USER_PAYABLE wallet with any pending that just became credited
    if (pending > 0) {
      const userWallet = await getOrCreateWallet(client, userId, 'USER_PAYABLE');
      await client.query('UPDATE wallets SET balance=balance+$1, updated_at=NOW() WHERE id=$2', [pending, userWallet.id]);
    }

    if (user.sponsor_id) {
      await processReferralIncome(client, user.sponsor_id, user.name);
    }

    await propagatePV(client, userId);
    await recalculateRankChain(client, userId);
    return true;
  }
  return false;
}

// ── RANK CALCULATION ─────────────────────────────────────────────────────────

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
    await client.query(`UPDATE users SET current_rank=$1, rank_updated_at=NOW() WHERE id=$2`, [newRank, userId]);
    return { promoted: true, oldRank, newRank };
  }
  return { promoted: false };
}

async function recalculateRankChain(client, userId) {
  let nodeRes = await client.query('SELECT id, parent_id FROM users WHERE id=$1', [userId]);
  let node = nodeRes.rows[0];
  while (node) {
    await recalculateRank(client, node.id);
    if (!node.parent_id) break;
    nodeRes = await client.query('SELECT id, parent_id FROM users WHERE id=$1', [node.parent_id]);
    node = nodeRes.rows[0];
  }
}

// ── COMPANY EARNED BALANCE GUARD ─────────────────────────────────────────────

async function checkSufficientCompanyEarnedBalance(client, amountRequired) {
  const wallet = await getOrCreateWallet(client, null, 'COMPANY_EARNED');
  const balance = parseFloat(wallet.balance || 0);
  return balance >= amountRequired;
}

// ── JACKPOT & INCENTIVE SLAB HELPERS ──────────────────────────────────────────

function getPlotBookingSlab(plots) {
  const count = parseInt(plots) || 0;
  if (count >= 151) return { pct: 10, nextMin: null, nextPct: null, currentRange: '151–500 plots' };
  if (count >= 81)  return { pct: 9,  nextMin: 151,  nextPct: 10,  currentRange: '81–150 plots' };
  if (count >= 36)  return { pct: 8,  nextMin: 81,   nextPct: 9,   currentRange: '36–80 plots' };
  if (count >= 16)  return { pct: 7,  nextMin: 36,   nextPct: 8,   currentRange: '16–35 plots' };
  if (count >= 6)   return { pct: 6,  nextMin: 16,   nextPct: 7,   currentRange: '6–15 plots' };
  if (count >= 1)   return { pct: 5,  nextMin: 6,    nextPct: 6,   currentRange: '1–5 plots' };
  return { pct: 0, nextMin: 1, nextPct: 5, currentRange: '0 plots' };
}

function getMonthlyTDSlab(tdAmount) {
  const amt = parseFloat(tdAmount) || 0;
  if (amt >= 20000000) return { pct: 5, nextMin: null, nextPct: null, currentSlab: '₹2 Crore+' };
  if (amt >= 8000000)  return { pct: 4, nextMin: 20000000, nextPct: 5, currentSlab: '₹80 Lakh+' };
  if (amt >= 2000000)  return { pct: 3, nextMin: 8000000,  nextPct: 4, currentSlab: '₹20 Lakh+' };
  if (amt >= 500000)   return { pct: 2, nextMin: 2000000,  nextPct: 3, currentSlab: '₹5 Lakh+' };
  return { pct: 0, nextMin: 500000, nextPct: 2, currentSlab: '< ₹5 Lakh' };
}

async function getAMReferralJackpotProgress(client, userId) {
  const l1Res = await client.query(
    `SELECT id FROM users WHERE sponsor_id=$1 AND current_rank<>'SA'`, [userId]
  );
  const l1Ids = l1Res.rows.map(r => r.id);
  const l1Count = l1Ids.length;

  let l2Count = 0;
  let l2Ids = [];
  if (l1Ids.length > 0) {
    const l2Res = await client.query(
      `SELECT id FROM users WHERE sponsor_id=ANY($1::int[]) AND current_rank<>'SA'`, [l1Ids]
    );
    l2Ids = l2Res.rows.map(r => r.id);
    l2Count = l2Ids.length;
  }

  let l3Count = 0;
  if (l2Ids.length > 0) {
    const l3Res = await client.query(
      `SELECT COUNT(*) AS cnt FROM users WHERE sponsor_id=ANY($1::int[]) AND current_rank<>'SA'`, [l2Ids]
    );
    l3Count = parseInt(l3Res.rows[0]?.cnt) || 0;
  }

  return {
    level1: { count: l1Count, target: 6, achieved: l1Count >= 6, label: '6 A.M. (Level 1)' },
    level2: { count: l2Count, target: 36, achieved: l2Count >= 36, label: '36 A.M. (Level 2)' },
    level3: { count: l3Count, target: 216, achieved: l3Count >= 216, label: '216 A.M. (Level 3)' }
  };
}

// ── REFERRAL MILESTONE BONUSES (SECTION 9) ───────────────────────────────────

const REFERRAL_MILESTONES = [
  { am_count: 6,   amount: 250000,  label: '₹2.5 Lakh' },
  { am_count: 12,  amount: 500000,  label: '₹5 Lakh'   },
  { am_count: 24,  amount: 1000000, label: '₹10 Lakh'  },
  { am_count: 48,  amount: 2000000, label: '₹20 Lakh'  },
  { am_count: 100, amount: 4500000, label: '₹45 Lakh'  },
  { am_count: 250, amount: 10000000,label: '₹1 Crore'  },
];

async function checkReferralMilestoneBonus(client, userId) {
  const directAMRes = await client.query(
    `SELECT COUNT(*) AS cnt FROM users WHERE sponsor_id=$1 AND current_rank<>'SA'`, [userId]
  );
  const directAMs = parseInt(directAMRes.rows[0]?.cnt) || 0;

  for (const milestone of REFERRAL_MILESTONES) {
    if (directAMs >= milestone.am_count) {
      const existing = await client.query(
        `SELECT id FROM referral_milestone_log WHERE user_id=$1 AND am_count=$2 AND status='credited'`,
        [userId, milestone.am_count]
      );
      if (!existing.rows.length) {
        const isSufficient = await checkSufficientCompanyEarnedBalance(client, milestone.amount);
        if (isSufficient) {
          await creditIncome(client, userId, 'non_working_income', milestone.amount,
            `Referral Milestone Bonus: ${milestone.am_count} direct AM referrals (${milestone.label})`, null);
          await client.query(
            `INSERT INTO referral_milestone_log (user_id, am_count, amount, status) VALUES ($1,$2,$3,'credited')`,
            [userId, milestone.am_count, milestone.amount]
          );
        } else {
          await client.query(
            `INSERT INTO referral_milestone_log (user_id, am_count, amount, status) VALUES ($1,$2,$3,'pending_company_funding')`,
            [userId, milestone.am_count, milestone.amount]
          );
          await recordMegaLedger(client, 'INTERNAL_ALLOCATION', 'milestone_deferred', milestone.amount,
            null, userId, `[DEFERRED] Referral Milestone Bonus for ${milestone.am_count} direct AMs deferred due to insufficient Company Earned balance`);
        }
      }
    }
  }
}

async function checkNonWorkingIncome(client, userId) {
  return checkReferralMilestoneBonus(client, userId);
}

/**
 * Monthly S.A.C.F. (Sales Associate Club Fund) Non-Working Income Job.
 *
 * Runs monthly to credit eligible active Sales Associates starting at A.M. (Area Manager) rank and above.
 * Funded via internal allocation from COMPANY_EARNED wallet to maintain accounting equality:
 * Mega Account = User Payable (sum) + Company Earned + Total Withdrawn
 *
 * @param {object} client - PG database client
 * @param {string} monthYear - Format 'YYYY-MM' (e.g. '2026-08')
 * @param {number} totalMonthlyTurnover - Total sales turnover for the month (optional override)
 */
async function runMonthlySACFJob(client, monthYear, totalMonthlyTurnover = 0) {
  // 1. Fetch active REAL_USER associates starting at A.M. rank and up (sort_order >= 1 per schema & Section 6 spec)
  const eligibleUsersRes = await client.query(`
    SELECT u.id, u.name, u.member_id, u.current_rank, r.name AS rank_name
    FROM users u
    JOIN ranks r ON u.current_rank = r.code
    WHERE u.role='user'
      AND u.is_active=true
      AND COALESCE(u.source_type, 'REAL_USER') = 'REAL_USER'
      AND r.sort_order >= 1
    ORDER BY r.sort_order ASC
  `);

  const eligibleUsers = eligibleUsersRes.rows;
  if (!eligibleUsers.length) {
    return { processedCount: 0, totalDistributed: 0, message: 'No eligible active associates (A.M. rank & up) found for S.A.C.F. monthly pool.' };
  }

  // 2. Calculate 10% pool from monthly turnover
  let turnover = totalMonthlyTurnover;
  if (!turnover || turnover <= 0) {
    const turnoverRes = await client.query(`
      SELECT COALESCE(SUM(amount), 0) AS total_deposits
      FROM transactions
      WHERE income_type='deposit'
        AND status='credited'
        AND TO_CHAR(created_at, 'YYYY-MM') = $1
    `, [monthYear]);
    turnover = parseFloat(turnoverRes.rows[0]?.total_deposits || 0);
  }

  // Pool is 10% of monthly deposit turnover (or fallback minimum baseline reward per associate if turnover log empty)
  const poolAmount = parseFloat((turnover * 0.10).toFixed(2));
  const perUserShare = poolAmount > 0
    ? parseFloat((poolAmount / eligibleUsers.length).toFixed(2))
    : 1000;

  // Filter out associates who already received S.A.C.F. for this monthYear
  const uncreditedUsers = [];
  for (const u of eligibleUsers) {
    const checkRes = await client.query(`
      SELECT id FROM transactions
      WHERE user_id=$1
        AND income_type='non_working_income'
        AND description LIKE $2
    `, [u.id, `%S.A.C.F. Monthly%${monthYear}%`]);

    if (checkRes.rows.length === 0) {
      uncreditedUsers.push(u);
    }
  }

  if (!uncreditedUsers.length) {
    return { processedCount: 0, totalDistributed: 0, message: `S.A.C.F. monthly income for ${monthYear} has already been processed for all eligible associates.` };
  }

  const totalDistributed = parseFloat((perUserShare * uncreditedUsers.length).toFixed(2));

  // 3. LEDGER INTEGRITY DEBIT: Debit COMPANY_EARNED wallet by totalDistributed to maintain accounting equality
  const companyWallet = await getOrCreateWallet(client, null, 'COMPANY_EARNED');
  await client.query('UPDATE wallets SET balance=balance-$1, updated_at=NOW() WHERE id=$2', [totalDistributed, companyWallet.id]);

  await recordMegaLedger(client, 'INTERNAL_ALLOCATION', 'sacf_monthly_pool', totalDistributed,
    companyWallet.id, null, `[S.A.C.F. DEBIT] Monthly Non-Working Income pool distribution for ${monthYear} funded from Company Earned Account`);

  // 4. Credit each user's wallet (creditIncome will update USER_PAYABLE wallet & log transaction)
  for (const u of uncreditedUsers) {
    const desc = `S.A.C.F. Monthly Non-Working Income (${monthYear}) — Rank: ${u.rank_name} (${u.current_rank})`;
    await creditIncome(client, u.id, 'non_working_income', perUserShare, desc, null);
  }

  return {
    processedCount: uncreditedUsers.length,
    totalDistributed,
    monthYear,
    perUserShare,
    fundedFrom: 'COMPANY_EARNED',
    eligibleRanks: 'A.M. (Area Manager) and up (11 promotion tiers)',
    message: `Monthly S.A.C.F. Non-Working Income credited to ${uncreditedUsers.length} associates for ${monthYear} (Total: ₹${totalDistributed}, funded from Company Earned Account)`
  };
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
  checkReferralMilestoneBonus,
  checkSufficientCompanyEarnedBalance,
  getPlotBookingSlab,
  getMonthlyTDSlab,
  getAMReferralJackpotProgress,
  runMonthlySACFJob,
  creditIncome,
  recordDepositInflow,
  processWithdrawal,
  getOrCreateWallet,
  recordMegaLedger,
  ACTIVATION_THRESHOLD,
  DAILY_PAIR_CAP,
  DAILY_MAX_INCOME,
  REFERRAL_INCOME,
  TDS_RATE,
  NWI_RATE,
  WITHHOLD_NWI_AT_WITHDRAWAL,
};

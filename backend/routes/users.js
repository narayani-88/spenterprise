const router = require('express').Router();
const bcrypt = require('bcryptjs');
const pool   = require('../db');
const auth   = require('../middleware/auth');
const { processReferralIncome, checkAndActivateUser, recalculateRankChain } = require('../services/incomeEngine');

// ── UTR VALIDATION HELPER ──────────────────────────────────────────────────────────────
// UTR / Transaction Reference number validation.
// Covers: NEFT (16 chars), RTGS (22 chars), IMPS (12 digits), UPI Ref (12-16 chars)
// Only alphanumeric characters allowed — NO special characters.
function isValidUTR(utr) {
  if (!utr || typeof utr !== 'string') return false;
  const cleaned = utr.trim();
  // 10–22 alphanumeric characters, uppercase/lowercase both OK
  return /^[A-Za-z0-9]{10,22}$/.test(cleaned);
}

router.use(auth);

// ── DASHBOARD ─────────────────────────────────────────────────────────────────
router.get('/dashboard', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT u.id,u.member_id,u.source_type,u.name,u.email,u.phone,u.referral_code,u.utr_number,
             u.wallet_balance,u.pending_balance,u.total_deposited,u.is_active,
             u.left_pv,u.right_pv,u.total_pairs AS pair_count,u.total_pairs,u.milestone_triggered,
             u.current_rank,u.kyc_status,u.created_at,
             p.name AS parent_name, p.member_id AS parent_member_id,
             s.name AS sponsor_name, s.member_id AS sponsor_member_id,
             lc.name AS left_child_name, lc.is_active AS left_child_active, lc.member_id AS left_child_member_id,
             rc.name AS right_child_name, rc.is_active AS right_child_active, rc.member_id AS right_child_member_id,
             r.name AS rank_name, r.short_name AS rank_short,
             (SELECT COALESCE(SUM(net_amount),0) FROM transactions WHERE user_id=u.id AND income_type='pair_income'    AND status='credited') AS total_pair_earned,
             (SELECT COALESCE(SUM(net_amount),0) FROM transactions WHERE user_id=u.id AND income_type='referral_income' AND status='credited') AS total_referral_earned,
             (SELECT COALESCE(SUM(net_amount),0) FROM transactions WHERE user_id=u.id AND income_type='smi_family_bonus' AND status='credited') AS total_smi_earned,
             (SELECT COALESCE(SUM(net_amount),0) FROM transactions WHERE user_id=u.id AND income_type IN ('milestone_commission','smi_family_bonus','non_working_income') AND status='credited') AS total_milestone_earned,
             (WITH RECURSIVE sub AS (SELECT id FROM users WHERE id=u.id UNION ALL SELECT c.id FROM users c JOIN sub ON c.parent_id=sub.id) SELECT COUNT(*)-1 FROM sub) AS downline_count
      FROM users u
      LEFT JOIN users p  ON u.parent_id=p.id
      LEFT JOIN users s  ON u.sponsor_id=s.id
      LEFT JOIN users lc ON u.left_child_id=lc.id
      LEFT JOIN users rc ON u.right_child_id=rc.id
      LEFT JOIN ranks r  ON u.current_rank=r.code
      WHERE u.id=$1`, [req.user.id]);

    if (!result.rows[0]) return res.status(404).json({ error: 'User not found' });
    res.json(result.rows[0]);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

// ── OWN SUBTREE ───────────────────────────────────────────────────────────────
router.get('/tree', async (req, res) => {
  try {
    const result = await pool.query(`
      WITH RECURSIVE subtree AS (
        SELECT id,member_id,COALESCE(source_type, 'REAL_USER') AS source_type,name,referral_code,utr_number,parent_id,position,
               left_child_id,right_child_id,left_pv,right_pv,
               wallet_balance,pending_balance,total_deposited,is_active,
               total_pairs,milestone_triggered,current_rank,kyc_status,created_at
        FROM users WHERE id=$1
        UNION ALL
        SELECT u.id,u.member_id,COALESCE(u.source_type, 'REAL_USER') AS source_type,u.name,u.referral_code,u.utr_number,u.parent_id,u.position,
               u.left_child_id,u.right_child_id,u.left_pv,u.right_pv,
               u.wallet_balance,u.pending_balance,u.total_deposited,u.is_active,
               u.total_pairs,u.milestone_triggered,u.current_rank,u.kyc_status,u.created_at
        FROM users u INNER JOIN subtree s ON u.parent_id=s.id
      )
      SELECT * FROM subtree`, [req.user.id]);

    const map = {};
    result.rows.forEach(u => { map[u.id] = { ...u }; });
    let root = null;
    result.rows.forEach(u => {
      if (u.id === req.user.id) { root = map[u.id]; return; }
      const p = map[u.parent_id];
      if (p) { if (u.position === 'left') p.left = map[u.id]; else p.right = map[u.id]; }
    });

    function computeCounts(node) {
      if (!node) return 0;
      const leftC = node.left ? computeCounts(node.left) : 0;
      const rightC = node.right ? computeCounts(node.right) : 0;
      node.left_count = leftC;
      node.right_count = rightC;
      node.total_downline = leftC + rightC;
      return 1 + leftC + rightC;
    }

    if (root) computeCounts(root);

    res.json(root);
  } catch (err) {
    console.error('❌ GET /api/user/tree 500 error:', err.message, err.stack);
    res.status(500).json({ error: 'Server error: ' + err.message });
  }
});

// ── UPLINE CHAIN ──────────────────────────────────────────────────────────────
router.get('/chain', async (req, res) => {
  try {
    const chain = [];
    let nodeRes = await pool.query('SELECT id, member_id, name, parent_id FROM users WHERE id=$1', [req.user.id]);
    let node = nodeRes.rows[0];
    while (node) {
      chain.push({ member_id: node.member_id, name: node.name });
      if (!node.parent_id) break;
      nodeRes = await pool.query('SELECT id, member_id, name, parent_id FROM users WHERE id=$1', [node.parent_id]);
      node = nodeRes.rows[0] || null;
    }
    res.json({ chain, display: chain.map(c => c.member_id).join(' → ') });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

async function findAvailableSlot(client, rootUserId, preferredPosition) {
  const rootRes = await client.query('SELECT id, left_child_id, right_child_id FROM users WHERE id=$1', [rootUserId]);
  const root = rootRes.rows[0];
  if (!root) return null;

  if (preferredPosition === 'left' && !root.left_child_id)   return { parentId: root.id, position: 'left' };
  if (preferredPosition === 'right' && !root.right_child_id)  return { parentId: root.id, position: 'right' };

  let queue = [];
  const startChildId = preferredPosition === 'left' ? root.left_child_id : root.right_child_id;
  if (startChildId) queue.push(startChildId);

  while (queue.length > 0) {
    const currId = queue.shift();
    const currRes = await client.query('SELECT id, left_child_id, right_child_id FROM users WHERE id=$1', [currId]);
    const curr = currRes.rows[0];
    if (!curr) continue;

    if (!curr.left_child_id)  return { parentId: curr.id, position: 'left' };
    if (!curr.right_child_id) return { parentId: curr.id, position: 'right' };

    queue.push(curr.left_child_id);
    queue.push(curr.right_child_id);
  }
  return null;
}

// ── ADD MEMBER TO OWN DOWNLINE ────────────────────────────────────────────────
router.post('/add-member', async (req, res) => {
  const { name, email, phone, password, position, parent_member_id } = req.body;
  if (!name || !email || !password || !position)
    return res.status(400).json({ error: 'Name, email, password and position required' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const meRes = await client.query('SELECT * FROM users WHERE id=$1', [req.user.id]);
    const me = meRes.rows[0];

    const emailCheck = await client.query('SELECT id FROM users WHERE email=$1', [email]);
    if (emailCheck.rows.length) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Email already registered' });
    }

    let targetParentId = me.id;
    let targetPosition = position;

    if (parent_member_id && parent_member_id.trim() && parent_member_id.trim().toUpperCase() !== me.member_id) {
      const parentRes = await client.query('SELECT id, left_child_id, right_child_id FROM users WHERE member_id=$1', [parent_member_id.trim().toUpperCase()]);
      if (!parentRes.rows.length) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: `Parent ID ${parent_member_id} not found` });
      }
      const parentUser = parentRes.rows[0];

      const directFree = (position === 'left' && !parentUser.left_child_id) || (position === 'right' && !parentUser.right_child_id);
      if (!directFree) {
        const slot = await findAvailableSlot(client, parentUser.id, position);
        if (!slot) {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: 'No available slot found in downline' });
        }
        targetParentId = slot.parentId;
        targetPosition = slot.position;
      } else {
        targetParentId = parentUser.id;
        targetPosition = position;
      }
    } else {
      // Automatic spillover down the chosen leg
      const slot = await findAvailableSlot(client, me.id, position);
      if (!slot) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'No available slot found in downline' });
      }
      targetParentId = slot.parentId;
      targetPosition = slot.position;
    }

    // Auto-generate member_id
    const lastIdRes = await client.query(
      `SELECT member_id FROM users WHERE member_id LIKE 'SP%' ORDER BY LENGTH(member_id) DESC, member_id DESC LIMIT 1`
    );
    let nextNum = 1;
    if (lastIdRes.rows.length) {
      const lastNum = parseInt(lastIdRes.rows[0].member_id.replace('SP', '')) || 0;
      nextNum = lastNum + 1;
    }
    const newMemberId = 'SP' + String(nextNum).padStart(4, '0');

    const hash = await bcrypt.hash(password, 10);

    // Member is ALWAYS sponsored by req.user.id (so logged in user receives Referral Income)
    const newUserRes = await client.query(`
      INSERT INTO users (member_id,name,email,phone,password_hash,plain_password,role,referral_code,referred_by,
                         sponsor_id,utr_number,parent_id,position)
      VALUES ($1,$2,$3,$4,$5,$6,'user',$7,$8,$9,NULL,$10,$11) RETURNING *`,
      [newMemberId, name, email, phone||null, hash, password, newMemberId, req.user.id, req.user.id, targetParentId, targetPosition]);
    const newUser = newUserRes.rows[0];

    const childCol = targetPosition === 'left' ? 'left_child_id' : 'right_child_id';
    await client.query(`UPDATE users SET ${childCol}=$1, updated_at=NOW() WHERE id=$2`, [newUser.id, targetParentId]);

    await client.query('COMMIT');
    res.status(201).json({
      message: `Member added! ID: ${newMemberId}`,
      user: { id: newUser.id, member_id: newMemberId, name, email }
    });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally { client.release(); }
});

// ── SUBMIT DEPOSIT ────────────────────────────────────────────────────────────
router.post('/deposit', async (req, res) => {
  const { amount, utr_number } = req.body;
  if (!amount || !utr_number)
    return res.status(400).json({ error: 'Amount and UTR number are required' });

  // Validate UTR: 10-22 alphanumeric characters, no spaces or special characters
  const utrCleaned = String(utr_number).trim().toUpperCase();
  if (!isValidUTR(utrCleaned)) {
    return res.status(400).json({
      error: 'Invalid UTR number. Must be 10–22 alphanumeric characters (letters and digits only, no spaces or special characters).'
    });
  }

  // Validate amount
  const parsedAmount = parseFloat(amount);
  if (isNaN(parsedAmount) || parsedAmount <= 0) {
    return res.status(400).json({ error: 'Invalid deposit amount' });
  }

  try {
    // Check for duplicate UTR within last 7 days to prevent double submission
    const dupCheck = await pool.query(
      `SELECT id FROM deposits WHERE utr_number=$1 AND created_at > NOW() - INTERVAL '7 days'`,
      [utrCleaned]
    );
    if (dupCheck.rows.length) {
      return res.status(409).json({ error: 'This UTR number has already been submitted. Please check your deposit history.' });
    }

    await pool.query(
      `INSERT INTO deposits (user_id, amount, utr_number) VALUES ($1, $2, $3)`,
      [req.user.id, parsedAmount, utrCleaned]
    );
    res.json({ message: 'Deposit submitted successfully. Awaiting company verification.' });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

// ── KYC SUBMISSION ─────────────────────────────────────────────────────────────
router.post('/kyc', async (req, res) => {
  const { pan_number, aadhar_number, bank_name, bank_account, bank_ifsc,
          nominee_name, nominee_relation, nominee_age, age, address, qualification, purpose } = req.body;
  try {
    await pool.query(`
      UPDATE users SET
        pan_number=$1, aadhar_number=$2, bank_name=$3, bank_account=$4, bank_ifsc=$5,
        nominee_name=$6, nominee_relation=$7, nominee_age=$8,
        age=$9, address=$10, qualification=$11, purpose=$12,
        kyc_status='pending', updated_at=NOW()
      WHERE id=$13`,
      [pan_number, aadhar_number, bank_name, bank_account, bank_ifsc,
       nominee_name, nominee_relation, nominee_age, age, address, qualification, purpose, req.user.id]);
    res.json({ message: 'KYC submitted for approval' });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// ── TRANSACTIONS ──────────────────────────────────────────────────────────────
router.get('/transactions', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT t.*, it.label AS income_label, r.name AS related_name
      FROM transactions t
      LEFT JOIN income_types it ON t.income_type=it.code
      LEFT JOIN users r ON t.related_user_id=r.id
      WHERE t.user_id=$1 ORDER BY t.created_at DESC LIMIT 100`, [req.user.id]);
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// ── DEPOSITS HISTORY ──────────────────────────────────────────────────────────
router.get('/deposits', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM deposits WHERE user_id=$1 ORDER BY created_at DESC`, [req.user.id]);
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// ── PV LOG ─────────────────────────────────────────────────────────────────────
router.get('/pv-log', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM daily_pair_log WHERE user_id=$1 ORDER BY log_date DESC LIMIT 30`, [req.user.id]);
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// ── CHANGE PASSWORD ───────────────────────────────────────────────────────────
router.post('/change-password', async (req, res) => {
  const { current_password, new_password } = req.body;
  if (!current_password || !new_password) return res.status(400).json({ error: 'Both passwords required' });
  if (new_password.length < 6) return res.status(400).json({ error: 'Min 6 characters' });
  try {
    const r = await pool.query('SELECT password_hash FROM users WHERE id=$1', [req.user.id]);
    const match = await bcrypt.compare(current_password, r.rows[0].password_hash);
    if (!match) return res.status(401).json({ error: 'Current password incorrect' });
    const hash = await bcrypt.hash(new_password, 10);
    await pool.query('UPDATE users SET password_hash=$1, updated_at=NOW() WHERE id=$2', [hash, req.user.id]);
    res.json({ message: 'Password changed' });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// ── WITHDRAWAL REQUESTS ───────────────────────────────────────────────────────
router.post('/withdraw', async (req, res) => {
  const { amount } = req.body;
  const numAmount = parseFloat(amount);
  if (!numAmount || isNaN(numAmount) || numAmount <= 0) {
    return res.status(400).json({ error: 'Valid positive amount required' });
  }

  try {
    const userRes = await pool.query(
      'SELECT wallet_balance, is_active, kyc_status, bank_account, bank_name, bank_ifsc FROM users WHERE id=$1',
      [req.user.id]
    );
    const user = userRes.rows[0];
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (!user.is_active) return res.status(400).json({ error: 'Account must be active to request withdrawals' });
    if (user.kyc_status !== 'approved') {
      return res.status(400).json({ error: 'KYC must be approved before requesting withdrawals' });
    }
    if (!user.bank_account || !user.bank_ifsc) {
      return res.status(400).json({ error: 'Please update bank details in profile before withdrawing' });
    }

    const currentWallet = parseFloat(user.wallet_balance || 0);

    // Check for existing pending request
    const pendingRes = await pool.query(
      "SELECT id FROM withdrawal_requests WHERE user_id=$1 AND status='pending'",
      [req.user.id]
    );
    if (pendingRes.rows.length) {
      return res.status(400).json({ error: 'You already have a pending withdrawal request' });
    }

    if (numAmount > currentWallet) {
      return res.status(400).json({ error: `Insufficient wallet balance. Available: ₹${currentWallet}` });
    }

    const tdsAmount = parseFloat((numAmount * 0.05).toFixed(2));
    const nwiAmount = 0.00; // S.A.C.F. is an Associate Monthly Reward Stream, not a withdrawal deduction
    const netAmount = parseFloat((numAmount - tdsAmount).toFixed(2));

    const insRes = await pool.query(
      `INSERT INTO withdrawal_requests (user_id, requested_amount, tds_rate, tds_amount, nwi_rate, nwi_amount, net_amount, status)
       VALUES ($1, $2, 5.00, $3, 0.00, $4, $5, 'pending') RETURNING *`,
      [req.user.id, numAmount, tdsAmount, nwiAmount, netAmount]
    );

    res.status(201).json({
      message: `Withdrawal request for ₹${numAmount} submitted! (Estimated net bank payout: ₹${netAmount} after statutory 5% TDS)`,
      request: insRes.rows[0]
    });
  } catch (err) {
    console.error('❌ POST /api/user/withdraw error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get('/withdrawals', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM withdrawal_requests WHERE user_id=$1 ORDER BY created_at DESC',
      [req.user.id]
    );
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

module.exports = router;

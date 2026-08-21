const router  = require('express').Router();
const bcrypt   = require('bcryptjs');
const pool     = require('../db');
const auth     = require('../middleware/auth');
const {
  checkAndActivateUser, processReferralIncome, recalculateRankChain, checkNonWorkingIncome, runDailyPairJob, creditIncome,
  recordDepositInflow, processWithdrawal, getOrCreateWallet, recordMegaLedger, runMonthlySACFJob
} = require('../services/incomeEngine');

// ── UTR VALIDATION HELPER ─────────────────────────────────────────────────────
// Indian UTR numbers are 12-digit numeric strings (NEFT/RTGS/IMPS reference)
// UPI reference numbers can be up to 12 digits too.
function isValidUTR(utr) {
  if (!utr || typeof utr !== 'string') return false;
  const cleaned = utr.trim();
  // Must be 10 to 22 alphanumeric characters (covers NEFT: 16, IMPS: 12, UPI Ref: 12-16)
  return /^[A-Z0-9]{10,22}$/i.test(cleaned);
}

router.use(auth, (req, res, next) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  next();
});

// ── DASHBOARD STATS ──────────────────────────────────────────────────────────
router.get('/dashboard', async (req, res) => {
  try {
    const stats = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM users WHERE role='user')                                AS total_members,
        (SELECT COUNT(*) FROM users WHERE role='user' AND is_active=true)             AS active_members,
        (SELECT COUNT(*) FROM users WHERE role='user' AND is_active=false)            AS inactive_members,
        (SELECT COALESCE(SUM(total_deposited),0) FROM users WHERE role='user')        AS total_funds_collected,
        (SELECT COUNT(*) FROM deposits WHERE status='pending')                        AS pending_deposits,
        (SELECT COUNT(*) FROM users WHERE kyc_status='pending' AND role='user')       AS pending_kyc,
        (SELECT COUNT(*) FROM withdrawal_requests WHERE status='pending')             AS pending_withdrawals,
        (SELECT COALESCE(SUM(requested_amount),0) FROM withdrawal_requests WHERE status='pending') AS pending_withdrawal_amount,
        (SELECT COALESCE(SUM(net_amount),0) FROM withdrawal_requests WHERE status='approved')      AS total_withdrawn_paid,
        (SELECT COALESCE(SUM(net_amount),0) FROM transactions WHERE income_type='pair_income'    AND status='credited') AS total_pair_paid,
        (SELECT COALESCE(SUM(net_amount),0) FROM transactions WHERE income_type='referral_income' AND status='credited') AS total_referral_paid,
        (SELECT COALESCE(SUM(net_amount),0) FROM transactions WHERE income_type='smi_family_bonus' AND status='credited') AS total_smi_paid,
        (SELECT COALESCE(SUM(net_amount),0) FROM transactions WHERE income_type IN ('pair_income','referral_income','smi_family_bonus','non_working_income') AND status='credited') AS total_payouts,
        (SELECT COALESCE(balance,0) FROM wallets WHERE wallet_type='MEGA_ACCOUNT' LIMIT 1) AS mega_account_balance,
        (SELECT COALESCE(balance,0) FROM wallets WHERE wallet_type='COMPANY_EARNED' LIMIT 1) AS company_earned_balance,
        (SELECT COALESCE(SUM(balance),0) FROM wallets WHERE wallet_type='USER_PAYABLE') AS user_liabilities_balance
    `);
    const row = stats.rows[0];
    row.net_company_balance = parseFloat(row.mega_account_balance || 0);
    res.json(row);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

// ── FULL NETWORK TREE ────────────────────────────────────────────────────────
router.get('/tree', async (req, res) => {
  try {
    const users = await pool.query(`
      SELECT id,member_id,source_type,name,email,role,referral_code,utr_number,parent_id,position,
             left_child_id,right_child_id,left_pv,right_pv,
             wallet_balance,pending_balance,total_deposited,is_active,
             total_pairs,milestone_triggered,current_rank,kyc_status,created_at
      FROM users ORDER BY id`);

    const map = {};
    users.rows.forEach(u => { map[u.id] = { ...u }; });

    let root = null;
    users.rows.forEach(u => {
      if (u.role === 'admin') { root = map[u.id]; return; }
      if (u.parent_id && map[u.parent_id]) {
        const p = map[u.parent_id];
        if (u.position === 'left')  p.left  = map[u.id];
        else                        p.right = map[u.id];
      }
    });

    // Recursively compute downline counts for all nodes in tree
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
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// ── ALL MEMBERS ──────────────────────────────────────────────────────────────
router.get('/users', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT u.id,u.member_id,u.source_type,u.name,u.email,u.phone,u.role,u.referral_code,u.utr_number,
             u.wallet_balance,u.pending_balance,u.total_deposited,u.is_active,
             u.left_pv,u.right_pv,u.total_pairs,u.milestone_triggered,
             u.current_rank,u.kyc_status,u.pan_number,u.created_at,
             u.age,u.address,u.qualification,u.purpose,u.aadhar_number,
             u.bank_name,u.bank_account,u.bank_ifsc,
             p.name AS parent_name, p.member_id AS parent_member_id, u.position,
             s.name AS sponsor_name, s.member_id AS sponsor_member_id,
             r.name AS rank_name, r.short_name AS rank_short
      FROM users u
      LEFT JOIN users p ON u.parent_id=p.id
      LEFT JOIN users s ON u.sponsor_id=s.id
      LEFT JOIN ranks r ON u.current_rank=r.code
      WHERE u.role='user'
      ORDER BY u.created_at DESC`);
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// ── GET SINGLE MEMBER DETAILS ───────────────────────────────────────────────
router.get('/members/:memberId', async (req, res) => {
  try {
    const { memberId } = req.params;
    const userRes = await pool.query(`
      SELECT u.*,
             p.name AS parent_name, p.member_id AS parent_member_id,
             s.name AS sponsor_name, s.member_id AS sponsor_member_id,
             r.name AS rank_name, r.short_name AS rank_short
      FROM users u
      LEFT JOIN users p ON u.parent_id=p.id
      LEFT JOIN users s ON u.sponsor_id=s.id
      LEFT JOIN ranks r ON u.current_rank=r.code
      WHERE UPPER(u.member_id)=$1`, [memberId.toUpperCase()]);

    if (!userRes.rows.length) return res.status(404).json({ error: 'Member not found' });
    const user = userRes.rows[0];

    // Compute left leg downline count
    let leftCount = 0;
    if (user.left_child_id) {
      try {
        const lRes = await pool.query(`
          WITH RECURSIVE dl AS (
            SELECT id FROM users WHERE id = $1
            UNION ALL
            SELECT u.id FROM users u JOIN dl d ON u.parent_id = d.id
          ) SELECT COUNT(*) FROM dl`, [user.left_child_id]);
        leftCount = parseInt(lRes.rows[0].count) || 0;
      } catch (e) { console.error('Left count error:', e); }
    }

    // Compute right leg downline count
    let rightCount = 0;
    if (user.right_child_id) {
      try {
        const rRes = await pool.query(`
          WITH RECURSIVE dr AS (
            SELECT id FROM users WHERE id = $1
            UNION ALL
            SELECT u.id FROM users u JOIN dr d ON u.parent_id = d.id
          ) SELECT COUNT(*) FROM dr`, [user.right_child_id]);
        rightCount = parseInt(rRes.rows[0].count) || 0;
      } catch (e) { console.error('Right count error:', e); }
    }

    user.left_count = leftCount;
    user.right_count = rightCount;
    user.total_downline = leftCount + rightCount;

    res.json(user);
  } catch (err) {
    console.error('Member lookup error:', err);
    res.status(500).json({ error: err.message || 'Server error' });
  }
});

// ── GET UPLINE CHAIN ─────────────────────────────────────────────────────────
router.get('/chain/:memberId', async (req, res) => {
  try {
    const userRes = await pool.query('SELECT id, member_id, name, parent_id FROM users WHERE member_id=$1', [req.params.memberId.toUpperCase()]);
    if (!userRes.rows.length) return res.status(404).json({ error: 'Member not found' });

    const chain = [];
    let node = userRes.rows[0];
    while (node) {
      chain.push({ member_id: node.member_id, name: node.name });
      if (!node.parent_id) break;
      const nextRes = await pool.query('SELECT id, member_id, name, parent_id FROM users WHERE id=$1', [node.parent_id]);
      node = nextRes.rows[0] || null;
    }
    res.json({ chain, display: chain.map(c => c.member_id).join(' → ') });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// ── FIND AVAILABLE SLOT (SPILLOVER HELPER) ───────────────────────────────────
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

// ── GENERATE NEXT MEMBER ID ──────────────────────────────────────────────────
async function generateMemberId(client) {
  const lastIdRes = await client.query(
    `SELECT member_id FROM users WHERE member_id LIKE 'BAP%' OR member_id LIKE 'SP%' ORDER BY LENGTH(member_id) DESC, member_id DESC LIMIT 1`
  );
  let nextNum = 1;
  if (lastIdRes.rows.length) {
    const raw = lastIdRes.rows[0].member_id.replace('BAP', '').replace('SP', '');
    const lastNum = parseInt(raw) || 0;
    nextNum = lastNum + 1;
  }
  return 'BAP' + String(nextNum).padStart(4, '0');
}

// ── ADD MEMBER ───────────────────────────────────────────────────────────────
router.post('/add-user', async (req, res) => {
  const {
    name, email, phone, password, parent_member_id, position,
    sponsor_member_id, age, address, qualification, purpose, source_type
  } = req.body;

  if (!name || !email || !password || !parent_member_id || !position)
    return res.status(400).json({ error: 'Required: name, email, password, parent Member ID, position' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Look up target parent by member_id
    const parentRes = await client.query('SELECT * FROM users WHERE member_id=$1', [parent_member_id.trim().toUpperCase()]);
    const requestedParent = parentRes.rows[0];
    if (!requestedParent) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: `Parent ID ${parent_member_id} not found` });
    }

    // Determine actual placement parent and position using spillover if direct slot is occupied
    let actualParentId = requestedParent.id;
    let actualPosition = position;

    const isDirectSlotFree = (position === 'left' && !requestedParent.left_child_id) || (position === 'right' && !requestedParent.right_child_id);

    if (!isDirectSlotFree) {
      const slot = await findAvailableSlot(client, requestedParent.id, position);
      if (!slot) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'No available placement slot found in downline' });
      }
      actualParentId = slot.parentId;
      actualPosition = slot.position;
    }

    const emailCheck = await client.query('SELECT id FROM users WHERE email=$1', [email]);
    if (emailCheck.rows.length) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Email already registered' });
    }

    // Sponsor resolution (by member_id, defaults to Company Admin)
    const adminUserRes = await client.query("SELECT id FROM users WHERE role='admin' ORDER BY id LIMIT 1");
    const companyAdminId = adminUserRes.rows[0] ? adminUserRes.rows[0].id : 1;

    let sponsorId = companyAdminId;
    if (sponsor_member_id && sponsor_member_id.trim()) {
      const sponsorRes = await client.query('SELECT id FROM users WHERE member_id=$1', [sponsor_member_id.trim().toUpperCase()]);
      if (sponsorRes.rows.length) sponsorId = sponsorRes.rows[0].id;
      else {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: `Sponsor ID ${sponsor_member_id} not found` });
      }
    }

    // Auto-generate member_id
    const newMemberId = await generateMemberId(client);
    const hash = await bcrypt.hash(password, 10);

    const sourceType = (source_type === 'COMPANY_PLACED') ? 'COMPANY_PLACED' : 'REAL_USER';

    const newUserRes = await client.query(`
      INSERT INTO users (member_id,source_type,name,email,phone,age,address,qualification,purpose,password_hash,plain_password,role,
                         referral_code,referred_by,sponsor_id,utr_number,parent_id,position)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'user',$12,$13,$14,$15,$16,$17) RETURNING *`,
      [newMemberId, sourceType, name, email, phone||null, age||null, address||null, qualification||null, purpose||null,
       hash, password, newMemberId, sponsorId, sponsorId, null, actualParentId, actualPosition]);
    const newUser = newUserRes.rows[0];

    // Update actual parent's child slot
    const childCol = actualPosition === 'left' ? 'left_child_id' : 'right_child_id';
    await client.query(`UPDATE users SET ${childCol}=$1, updated_at=NOW() WHERE id=$2`, [newUser.id, actualParentId]);

    // Build upline chain: new → parent → ... → company
    const chain = [newMemberId];
    let chainNode = await client.query('SELECT id, member_id, parent_id FROM users WHERE id=$1', [actualParentId]).then(r => r.rows[0]);
    while (chainNode) {
      chain.push(chainNode.member_id);
      if (!chainNode.parent_id) break;
      const nextRes = await client.query('SELECT id, member_id, parent_id FROM users WHERE id=$1', [chainNode.parent_id]);
      chainNode = nextRes.rows[0] || null;
    }

    await client.query('COMMIT');
    res.status(201).json({
      message: `Member added! ID: ${newMemberId}`,
      user: { id: newUser.id, member_id: newMemberId, name, email },
      chain: chain.join(' → ')
    });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally { client.release(); }
});

// ── DEPOSITS ─────────────────────────────────────────────────────────────────
router.get('/deposits', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT d.*,u.name AS user_name,u.email AS user_email,u.member_id AS user_member_id,
             u.utr_number AS assigned_utr,u.total_deposited,u.is_active
      FROM deposits d JOIN users u ON d.user_id=u.id
      ORDER BY d.created_at DESC`);
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

router.post('/deposits/:id/approve', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const depRes = await client.query('SELECT * FROM deposits WHERE id=$1', [req.params.id]);
    const deposit = depRes.rows[0];
    if (!deposit) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Not found' });
    }
    if (deposit.status !== 'pending') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Already processed' });
    }

    const userRes = await client.query('SELECT * FROM users WHERE id=$1', [deposit.user_id]);
    const user = userRes.rows[0];

    // Save verified UTR number on user profile upon deposit approval
    await client.query(
      `UPDATE deposits SET status='approved', verified_by=$1, verified_at=NOW() WHERE id=$2`,
      [req.user.id, deposit.id]
    );
    await client.query(
      `UPDATE users SET total_deposited=total_deposited+$1, utr_number=$2, updated_at=NOW() WHERE id=$3`,
      [deposit.amount, deposit.utr_number, deposit.user_id]
    );

    // Record deposit inflow to Mega Account & Mega Ledger
    await recordDepositInflow(client, deposit.user_id, deposit.amount, `Deposit ₹${deposit.amount} approved for ${user.member_id}`);

    await client.query(
      `INSERT INTO transactions (user_id,income_type,amount,net_amount,description,status) VALUES ($1,'deposit',$2,$2,$3,'credited')`,
      [deposit.user_id, deposit.amount, `Deposit ₹${deposit.amount} approved`]
    );

    const activated = await checkAndActivateUser(client, deposit.user_id);
    if (activated) {
      await recalculateRankChain(client, deposit.user_id);
      await checkNonWorkingIncome(client, deposit.user_id);
    }

    await client.query('COMMIT');
    res.json({ message: activated ? `Deposit approved — ${user.member_id} ACTIVATED! PV propagated.` : 'Deposit approved', activated });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally { client.release(); }
});

router.post('/deposits/:id/reject', async (req, res) => {
  try {
    const depRes = await pool.query('SELECT status FROM deposits WHERE id=$1', [req.params.id]);
    if (!depRes.rows[0]) return res.status(404).json({ error: 'Not found' });
    if (depRes.rows[0].status !== 'pending') return res.status(400).json({ error: 'Already processed' });
    await pool.query(
      `UPDATE deposits SET status='rejected', verified_by=$1, verified_at=NOW(), notes=$2 WHERE id=$3`,
      [req.user.id, req.body.notes || 'Rejected', req.params.id]
    );
    res.json({ message: 'Deposit rejected' });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// ── KYC APPROVAL ─────────────────────────────────────────────────────────────
router.post('/kyc/:userId/approve', async (req, res) => {
  try {
    await pool.query(
      `UPDATE users SET kyc_status='approved', updated_at=NOW() WHERE id=$1 AND role='user'`,
      [req.params.userId]
    );
    res.json({ message: 'KYC approved' });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

router.post('/kyc/:userId/reject', async (req, res) => {
  try {
    await pool.query(
      `UPDATE users SET kyc_status='rejected', updated_at=NOW() WHERE id=$1`,
      [req.params.userId]
    );
    res.json({ message: 'KYC rejected' });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// ── TRANSACTIONS ──────────────────────────────────────────────────────────────
router.get('/transactions', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT t.*,u.name AS user_name,u.member_id AS user_member_id,r.name AS related_name, it.label AS income_label
      FROM transactions t
      JOIN users u ON t.user_id=u.id
      LEFT JOIN users r ON t.related_user_id=r.id
      LEFT JOIN income_types it ON t.income_type=it.code
      ORDER BY t.created_at DESC LIMIT 300`);
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

router.post('/transactions/:id/approve', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const txRes = await client.query('SELECT * FROM transactions WHERE id=$1 FOR UPDATE', [req.params.id]);
    const tx = txRes.rows[0];
    if (!tx) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Transaction not found' });
    }
    if (tx.status === 'credited') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Already credited' });
    }

    await client.query(`UPDATE transactions SET status='credited' WHERE id=$1`, [tx.id]);
    await client.query(
      `UPDATE users SET wallet_balance=wallet_balance+$1, pending_balance=GREATEST(0, pending_balance-$1), updated_at=NOW() WHERE id=$2`,
      [tx.net_amount, tx.user_id]
    );

    const userRes = await client.query('SELECT role FROM users WHERE id=$1', [tx.user_id]);
    if (userRes.rows[0]?.role !== 'admin') {
      await client.query(`UPDATE users SET wallet_balance=wallet_balance-$1, updated_at=NOW() WHERE role='admin'`, [tx.net_amount]);
    }

    await client.query('COMMIT');
    res.json({ message: 'Transaction approved & credited to member wallet!' });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally { client.release(); }
});

// ── DAILY PAIR LOG ────────────────────────────────────────────────────────────
router.get('/daily-pair-log', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT dl.*, u.name AS user_name, u.member_id AS user_member_id
      FROM daily_pair_log dl JOIN users u ON dl.user_id=u.id
      ORDER BY dl.log_date DESC, dl.user_id LIMIT 200`);
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// ── RANKS LIST ────────────────────────────────────────────────────────────────
router.get('/ranks', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM ranks ORDER BY sort_order');
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});
// ── RESET MEMBER PASSWORD ─────────────────────────────────────────────────────
router.post('/members/:memberId/reset-password', async (req, res) => {
  try {
    const { memberId } = req.params;
    const userRes = await pool.query(
      'SELECT id, name, member_id FROM users WHERE member_id=$1 AND role=$2',
      [memberId.toUpperCase(), 'user']
    );
    if (!userRes.rows.length) return res.status(404).json({ error: 'Member not found' });
    const member = userRes.rows[0];

    // Generate a secure temp password
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789@#!';
    let tempPassword = '';
    for (let i = 0; i < 10; i++) tempPassword += chars[Math.floor(Math.random() * chars.length)];

    const hash = await bcrypt.hash(tempPassword, 10);
    await pool.query(
      'UPDATE users SET password_hash=$1, plain_password=$2, updated_at=NOW() WHERE id=$3',
      [hash, tempPassword, member.id]
    );

    res.json({
      message: `Password reset for ${member.name}`,
      member_id: member.member_id,
      name: member.name,
      temp_password: tempPassword
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── DAILY PAIR JOB TRIGGER ───────────────────────────────────────────────────
router.post('/run-daily-job', async (req, res) => {
  try {
    await runDailyPairJob();
    res.json({ message: 'Daily pair matching job executed successfully!' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── CONTACT SUBMISSIONS (from public website) ─────────────────────────────────
router.get('/contacts', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM contact_submissions ORDER BY created_at DESC LIMIT 200'
    );
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

router.post('/contacts/:id/read', async (req, res) => {
  try {
    await pool.query('UPDATE contact_submissions SET is_read=true WHERE id=$1', [req.params.id]);
    res.json({ message: 'Marked as read' });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

router.delete('/contacts/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM contact_submissions WHERE id=$1', [req.params.id]);
    res.json({ message: 'Deleted' });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// ── FIX MILESTONES ───────────────────────────────────────────────────────────
router.post('/fix-milestones', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Find all active users with >= 10 total_pairs but milestone_triggered=false
    const usersRes = await client.query(`
      SELECT id, name, member_id, sponsor_id FROM users
      WHERE role='user' AND is_active=true AND total_pairs >= 10 AND milestone_triggered=false
    `);
    const fixed = [];
    for (const u of usersRes.rows) {
      await client.query('UPDATE users SET milestone_triggered=true WHERE id=$1', [u.id]);
      await creditIncome(client, u.id, 'milestone_commission', 10000, '🏆 Milestone Bonus Fix: 10 Pairs Reached!', null);
      fixed.push({ member_id: u.member_id, name: u.name });
    }
    await client.query('COMMIT');
    res.json({ message: `Fixed ${fixed.length} milestone(s)`, fixed });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally { client.release(); }
});

// ── WITHDRAWALS MANAGEMENT ────────────────────────────────────────────────────
router.get('/withdrawals', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT w.*, u.name AS user_name, u.member_id AS user_member_id, u.email AS user_email,
             u.bank_name, u.bank_account, u.bank_ifsc, u.pan_number, u.wallet_balance AS current_wallet_balance
      FROM withdrawal_requests w
      JOIN users u ON w.user_id = u.id
      ORDER BY w.created_at DESC`);
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

router.post('/withdrawals/:id/approve', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await processWithdrawal(client, req.params.id, req.user.id);
    await client.query('COMMIT');
    res.json({
      message: `Withdrawal approved for ${result.memberName} (${result.memberId})! Net paid: ₹${result.netAmount} (TDS 5%: ₹${result.tdsAmount}, NWI 10%: ₹${result.nwiAmount})`,
      details: result
    });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(400).json({ error: err.message });
  } finally { client.release(); }
});

router.post('/withdrawals/:id/reject', async (req, res) => {
  try {
    const { notes } = req.body;
    const wRes = await pool.query('SELECT status FROM withdrawal_requests WHERE id=$1', [req.params.id]);
    if (!wRes.rows[0]) return res.status(404).json({ error: 'Withdrawal request not found' });
    if (wRes.rows[0].status !== 'pending') return res.status(400).json({ error: 'Request already processed' });

    await pool.query(
      `UPDATE withdrawal_requests SET status='rejected', approved_by=$1, notes=$2, processed_at=NOW() WHERE id=$3`,
      [req.user.id, notes || 'Rejected by admin', req.params.id]
    );
    res.json({ message: 'Withdrawal request rejected' });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// ── MEGA LEDGER AUDIT TRAIL ───────────────────────────────────────────────────
router.get('/mega-ledger', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT ml.*, u.name AS user_name, u.member_id AS user_member_id, w.wallet_type
      FROM mega_ledger ml
      LEFT JOIN users u ON ml.related_user_id = u.id
      LEFT JOIN wallets w ON ml.related_wallet_id = w.id
      ORDER BY ml.created_at DESC LIMIT 300`);
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// ── CONVERT ID SOURCE TYPE (REAL_USER <-> COMPANY_PLACED) ────────────────────
router.post('/members/:memberId/convert-source', async (req, res) => {
  const client = await pool.connect();
  try {
    const { memberId } = req.params;
    const { reason, confirm_demotion } = req.body || {};

    const userRes = await client.query(
      'SELECT id, name, member_id, source_type, wallet_balance FROM users WHERE UPPER(member_id)=$1',
      [memberId.toUpperCase()]
    );
    if (!userRes.rows.length) return res.status(404).json({ error: 'Member not found' });
    const member = userRes.rows[0];

    const oldSourceType = member.source_type || 'REAL_USER';
    const newSourceType = oldSourceType === 'COMPANY_PLACED' ? 'REAL_USER' : 'COMPANY_PLACED';

    // Security Check: If converting REAL_USER -> COMPANY_PLACED (stripping withdrawable earning rights)
    if (oldSourceType === 'REAL_USER' && newSourceType === 'COMPANY_PLACED') {
      if (!reason || reason.trim().length < 5) {
        return res.status(400).json({
          error: 'Conversion reason required (at least 5 characters) when converting Real Associate to Company Placed.'
        });
      }
      if (parseFloat(member.wallet_balance || 0) > 0 && !confirm_demotion) {
        return res.status(400).json({
          error: `Member ${member.member_id} has active wallet balance of ₹${member.wallet_balance}. Please confirm demotion explicitly.`,
          requiresConfirmation: true
        });
      }
    }

    await client.query('BEGIN');

    await client.query(
      'UPDATE users SET source_type=$1, updated_at=NOW() WHERE id=$2',
      [newSourceType, member.id]
    );

    // Record immutable audit entry in mega_ledger detailing explicit balance preservation
    const cleanedReason = (reason && reason.trim()) ? reason.trim() : 'Source classification updated by admin';
    const balanceInfo = `ACCRUED BALANCE PRESERVED: ₹${member.wallet_balance || 0} remains in USER_PAYABLE. Only future earnings route to ${newSourceType === 'COMPANY_PLACED' ? 'COMPANY_EARNED' : 'USER_PAYABLE'}.`;
    const auditDesc = `[SECURITY_AUDIT] Source type changed for ${member.member_id} (${member.name}) from ${oldSourceType} to ${newSourceType} by Admin (ID: ${req.user.id}). Reason: "${cleanedReason}". ${balanceInfo}`;
    await recordMegaLedger(client, 'SECURITY_AUDIT', 'source_type_change', 0, null, member.id, auditDesc);

    await client.query('COMMIT');

    res.json({
      message: `ID ${member.member_id} (${member.name}) changed from ${oldSourceType} to ${newSourceType}! ${balanceInfo}`,
      newSourceType,
      oldSourceType,
      accruedBalancePreserved: parseFloat(member.wallet_balance || 0)
    });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally { client.release(); }
});

// ── RUN MONTHLY S.A.C.F. NON-WORKING INCOME JOB ─────────────────────────────
router.post('/run-monthly-sacf', async (req, res) => {
  const client = await pool.connect();
  try {
    const { monthYear, totalMonthlyTurnover } = req.body || {};
    const targetMonth = monthYear || new Date().toISOString().slice(0, 7); // Default YYYY-MM

    await client.query('BEGIN');
    const result = await runMonthlySACFJob(client, targetMonth, parseFloat(totalMonthlyTurnover || 0));
    await client.query('COMMIT');

    res.json(result);
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally { client.release(); }
});

// ── DATABASE MIGRATIONS ─────────────────────────────────────────────────────
// Call this once after deploying to Render to add any new columns & tables
router.post('/migrate', async (req, res) => {
  const results = [];
  const migrations = [
    { col: 'source_type',   sql: `ALTER TABLE users ADD COLUMN IF NOT EXISTS source_type VARCHAR(20) DEFAULT 'REAL_USER' CHECK (source_type IN ('REAL_USER','COMPANY_PLACED'))` },
    { col: 'plain_password', sql: `ALTER TABLE users ADD COLUMN IF NOT EXISTS plain_password TEXT` },
    { col: 'age',            sql: `ALTER TABLE users ADD COLUMN IF NOT EXISTS age TEXT` },
    { col: 'address',        sql: `ALTER TABLE users ADD COLUMN IF NOT EXISTS address TEXT` },
    { col: 'qualification',  sql: `ALTER TABLE users ADD COLUMN IF NOT EXISTS qualification TEXT` },
    { col: 'purpose',        sql: `ALTER TABLE users ADD COLUMN IF NOT EXISTS purpose TEXT` },
    { col: 'aadhar_number',  sql: `ALTER TABLE users ADD COLUMN IF NOT EXISTS aadhar_number TEXT` },
    { col: 'bank_name',      sql: `ALTER TABLE users ADD COLUMN IF NOT EXISTS bank_name TEXT` },
    { col: 'bank_account',   sql: `ALTER TABLE users ADD COLUMN IF NOT EXISTS bank_account TEXT` },
    { col: 'bank_ifsc',      sql: `ALTER TABLE users ADD COLUMN IF NOT EXISTS bank_ifsc TEXT` },
    { col: 'wallets_table',  sql: `CREATE TABLE IF NOT EXISTS wallets (
        id SERIAL PRIMARY KEY, owner_id INT REFERENCES users(id) ON DELETE CASCADE,
        wallet_type VARCHAR(20) NOT NULL CHECK (wallet_type IN ('USER_PAYABLE', 'COMPANY_EARNED', 'MEGA_ACCOUNT')),
        balance DECIMAL(14,2) DEFAULT 0, created_at TIMESTAMP DEFAULT NOW(), updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(owner_id, wallet_type))` },
    { col: 'mega_ledger_table', sql: `CREATE TABLE IF NOT EXISTS mega_ledger (
        id SERIAL PRIMARY KEY, transaction_type VARCHAR(30) NOT NULL CHECK (transaction_type IN ('INFLOW', 'OUTFLOW', 'INTERNAL_ALLOCATION')),
        category VARCHAR(40) NOT NULL, amount DECIMAL(14,2) NOT NULL, related_wallet_id INT REFERENCES wallets(id),
        related_user_id INT REFERENCES users(id), description TEXT, created_at TIMESTAMP DEFAULT NOW())` },
    { col: 'withdrawal_table', sql: `CREATE TABLE IF NOT EXISTS withdrawal_requests (
        id SERIAL PRIMARY KEY, user_id INT REFERENCES users(id) ON DELETE CASCADE NOT NULL, requested_amount DECIMAL(12,2) NOT NULL,
        tds_rate DECIMAL(5,2) DEFAULT 5.00, tds_amount DECIMAL(12,2) DEFAULT 0, nwi_rate DECIMAL(5,2) DEFAULT 10.00,
        nwi_amount DECIMAL(12,2) DEFAULT 0, net_amount DECIMAL(12,2) DEFAULT 0, status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','processing')),
        approved_by INT REFERENCES users(id), notes TEXT, created_at TIMESTAMP DEFAULT NOW(), processed_at TIMESTAMP)` }
  ];
  for (const m of migrations) {
    try {
      await pool.query(m.sql);
      results.push({ column: m.col, status: 'OK' });
    } catch (e) {
      results.push({ column: m.col, status: 'ERROR', error: e.message });
    }
  }
  res.json({ message: 'Migration complete', results });
});

module.exports = router;

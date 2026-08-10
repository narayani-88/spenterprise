const router  = require('express').Router();
const bcrypt   = require('bcryptjs');
const pool     = require('../db');
const auth     = require('../middleware/auth');
const {
  checkAndActivateUser, processReferralIncome, recalculateRankChain, checkNonWorkingIncome, runDailyPairJob, creditIncome
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
        (SELECT COALESCE(SUM(net_amount),0) FROM transactions WHERE income_type='pair_income'    AND status='credited') AS total_pair_paid,
        (SELECT COALESCE(SUM(net_amount),0) FROM transactions WHERE income_type='referral_income' AND status='credited') AS total_referral_paid,
        (SELECT COALESCE(SUM(net_amount),0) FROM transactions WHERE income_type='smi_family_bonus' AND status='credited') AS total_smi_paid,
        (SELECT COALESCE(SUM(net_amount),0) FROM transactions WHERE income_type IN ('pair_income','referral_income','smi_family_bonus','non_working_income') AND status='credited') AS total_payouts
    `);
    const row = stats.rows[0];
    row.net_company_balance = parseFloat(row.total_funds_collected) - parseFloat(row.total_payouts);
    res.json(row);
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// ── FULL NETWORK TREE ────────────────────────────────────────────────────────
router.get('/tree', async (req, res) => {
  try {
    const users = await pool.query(`
      SELECT id,member_id,name,email,role,referral_code,utr_number,parent_id,position,
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
    res.json(root);
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// ── ALL MEMBERS ──────────────────────────────────────────────────────────────
router.get('/users', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT u.id,u.member_id,u.name,u.email,u.phone,u.role,u.referral_code,u.utr_number,
             u.wallet_balance,u.pending_balance,u.total_deposited,u.is_active,
             u.left_pv,u.right_pv,u.total_pairs,u.milestone_triggered,
             u.current_rank,u.kyc_status,u.pan_number,u.created_at,
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

// ── GENERATE NEXT MEMBER ID ──────────────────────────────────────────────────
async function generateMemberId(client) {
  const lastIdRes = await client.query(
    `SELECT member_id FROM users WHERE member_id LIKE 'SP%' ORDER BY LENGTH(member_id) DESC, member_id DESC LIMIT 1`
  );
  let nextNum = 1;
  if (lastIdRes.rows.length) {
    const lastNum = parseInt(lastIdRes.rows[0].member_id.replace('SP', '')) || 0;
    nextNum = lastNum + 1;
  }
  return 'SP' + String(nextNum).padStart(4, '0');
}

// ── ADD MEMBER ───────────────────────────────────────────────────────────────
router.post('/add-user', async (req, res) => {
  const {
    name, email, phone, password, parent_member_id, position,
    sponsor_member_id, age, address, qualification, purpose
  } = req.body;

  if (!name || !email || !password || !parent_member_id || !position)
    return res.status(400).json({ error: 'Required: name, email, password, parent Member ID, position' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Look up parent by member_id
    const parentRes = await client.query('SELECT * FROM users WHERE member_id=$1', [parent_member_id.trim().toUpperCase()]);
    const parent = parentRes.rows[0];
    if (!parent) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: `Parent ID ${parent_member_id} not found` });
    }
    if (position === 'left' && parent.left_child_id) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: `${parent_member_id} LEFT slot is already occupied` });
    }
    if (position === 'right' && parent.right_child_id) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: `${parent_member_id} RIGHT slot is already occupied` });
    }

    const emailCheck = await client.query('SELECT id FROM users WHERE email=$1', [email]);
    if (emailCheck.rows.length) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Email already registered' });
    }

    // Sponsor resolution (by member_id, defaults to parent)
    let sponsorId = parent.id;
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

    const newUserRes = await client.query(`
      INSERT INTO users (member_id,name,email,phone,age,address,qualification,purpose,password_hash,role,
                         referral_code,referred_by,sponsor_id,utr_number,parent_id,position)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'user',$10,$11,$12,$13,$14,$15) RETURNING *`,
      [newMemberId, name, email, phone||null, age||null, address||null, qualification||null, purpose||null,
       hash, newMemberId, sponsorId, sponsorId, null, parent.id, position]);
    const newUser = newUserRes.rows[0];

    // Update parent's child slot
    const childCol = position === 'left' ? 'left_child_id' : 'right_child_id';
    await client.query(`UPDATE users SET ${childCol}=$1, updated_at=NOW() WHERE id=$2`, [newUser.id, parent.id]);

    // Build upline chain: new → parent → ... → company
    const chain = [newMemberId];
    let chainNode = parent;
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

    // Increase Company Admin wallet balance (Company Funds Received)
    await client.query(
      `UPDATE users SET wallet_balance=wallet_balance+$1, updated_at=NOW() WHERE role='admin'`,
      [deposit.amount]
    );

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
    await pool.query('UPDATE users SET password_hash=$1, updated_at=NOW() WHERE id=$2', [hash, member.id]);

    res.json({
      message: `Password reset for ${member.name}`,
      member_id: member.member_id,
      name: member.name,
      temp_password: tempPassword   // shown once to admin, never stored in plain text
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

module.exports = router;

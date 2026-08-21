const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../db');
const authMiddleware = require('../middleware/auth');
require('dotenv').config();

// POST /api/auth/login — accepts member_id OR email
router.post('/login', async (req, res) => {
  const { login, password } = req.body;
  if (!login || !password) return res.status(400).json({ error: 'Member ID/Email and password required' });
  try {
    // Normalize login query parameter (support BAP0000 / admin@bookapnaplot.com and legacy SP0000 / admin@spenterprise.com)
    const cleanLogin = login.trim();
    const result = await pool.query(
      `SELECT * FROM users
       WHERE LOWER(member_id) = LOWER($1)
          OR LOWER(email) = LOWER($1)
          OR (role='admin' AND ($1 = 'admin@spenterprise.com' OR LOWER($1) = 'sp0000'))`,
      [cleanLogin]
    );
    const user = result.rows[0];
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) return res.status(401).json({ error: 'Invalid credentials' });
    const secret = process.env.JWT_SECRET || 'super_secret_jwt_key_default';
    const token = jwt.sign(
      { id: user.id, role: user.role, name: user.name, email: user.email, member_id: user.member_id },
      secret,
      { expiresIn: '7d' }
    );
    res.json({
      token,
      user: {
        id: user.id,
        member_id: user.member_id,
        name: user.name,
        email: user.email,
        role: user.role,
        referral_code: user.referral_code
      }
    });
  } catch (err) {
    console.error('❌ Login Auth Error:', err);
    res.status(500).json({ error: err.message || 'Server error' });
  }
});

// POST /api/auth/change-password
router.post('/change-password', authMiddleware, async (req, res) => {
  const { current_password, new_password } = req.body;
  if (!current_password || !new_password) return res.status(400).json({ error: 'Both passwords required' });
  if (new_password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
  try {
    const result = await pool.query('SELECT * FROM users WHERE id=$1', [req.user.id]);
    const user = result.rows[0];
    const match = await bcrypt.compare(current_password, user.password_hash);
    if (!match) return res.status(401).json({ error: 'Current password is incorrect' });
    const hash = await bcrypt.hash(new_password, 10);
    await pool.query('UPDATE users SET password_hash=$1, updated_at=NOW() WHERE id=$2', [hash, req.user.id]);
    res.json({ message: 'Password changed successfully' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;

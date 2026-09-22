const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const pool = require('../db');

async function inspect() {
  const client = await pool.connect();
  try {
    console.log('=== REFERRALS BREAKDOWN ===\n');

    const sponsors = await client.query(`
      SELECT s.id, s.member_id, s.name,
             COUNT(u.id) AS total_direct_referrals,
             COUNT(CASE WHEN u.is_active = true THEN 1 END) AS active_direct_referrals
      FROM users s
      LEFT JOIN users u ON u.sponsor_id = s.id
      WHERE s.role = 'user'
      GROUP BY s.id, s.member_id, s.name
      ORDER BY s.id ASC
    `);

    console.table(sponsors.rows.map(r => ({
      ID: r.id,
      'Member ID': r.member_id,
      Name: r.name,
      'Total Referrals': r.total_direct_referrals,
      'Active Referrals': r.active_direct_referrals,
      'Expected Referral Income': `₹${r.active_direct_referrals * 2000}`
    })));

    console.log('\n=== WHO REFERRED WHOM ===\n');
    const links = await client.query(`
      SELECT u.id, u.member_id, u.name, u.is_active,
             s.member_id AS sponsor_id, s.name AS sponsor_name,
             p.member_id AS parent_id, p.name AS parent_name, u.position
      FROM users u
      LEFT JOIN users s ON u.sponsor_id = s.id
      LEFT JOIN users p ON u.parent_id = p.id
      WHERE u.role = 'user'
      ORDER BY u.id ASC
    `);

    console.table(links.rows.map(r => ({
      ID: r.id,
      Member: `${r.name} (${r.member_id})`,
      'Referred By (Sponsor)': r.sponsor_name ? `${r.sponsor_name} (${r.sponsor_id})` : 'Company / Admin',
      'Binary Parent': r.parent_name ? `${r.parent_name} (${r.parent_id}) [${r.position}]` : 'Root',
      Active: r.is_active
    })));

  } finally {
    client.release();
    pool.end();
  }
}

inspect().catch(console.error);

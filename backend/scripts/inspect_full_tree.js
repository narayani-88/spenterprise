const pool = require('../db');

async function inspectFullTree() {
  const client = await pool.connect();
  try {
    console.log('=== USERS & SPONSORS AUDIT ===\n');

    const users = await client.query(`
      SELECT u.id, u.member_id, u.name, u.source_type, u.role,
             u.sponsor_id, s.member_id AS sponsor_member_id, s.name AS sponsor_name,
             u.parent_id, p.member_id AS parent_member_id, u.position,
             u.wallet_balance, u.total_deposited, u.is_active
      FROM users u
      LEFT JOIN users s ON u.sponsor_id = s.id
      LEFT JOIN users p ON u.parent_id = p.id
      ORDER BY u.id ASC
    `);

    console.table(users.rows.map(r => ({
      ID: r.id,
      Member: `${r.name} (${r.member_id})`,
      Type: r.source_type,
      Role: r.role,
      Sponsor: r.sponsor_member_id ? `${r.sponsor_name} (${r.sponsor_member_id})` : 'NONE',
      Parent: r.parent_member_id ? `${r.parent_member_id} (${r.position})` : 'ROOT',
      Wallet: `₹${r.wallet_balance}`,
      Active: r.is_active
    })));

  } finally {
    client.release();
    pool.end();
  }
}

inspectFullTree().catch(console.error);

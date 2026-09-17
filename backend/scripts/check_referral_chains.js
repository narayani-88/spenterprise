/**
 * Check referral chain structure for manual PMI calculation
 */
const pool = require('../db');

async function checkReferralChains() {
  const client = await pool.connect();
  try {
    const users = await client.query('SELECT id, member_id, name, sponsor_id, role FROM users ORDER BY id');
    console.log('🔗 All Users Referral Chains:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    for (const user of users.rows) {
      const sponsor = user.sponsor_id ? users.rows.find(u => u.id === user.sponsor_id) : null;
      console.log(`👤 ${user.member_id} - ${user.name} (${user.role})`);
      if (sponsor) {
        console.log(`   Sponsor: ${sponsor.member_id} - ${sponsor.name} (${sponsor.role})`);
      } else {
        console.log(`   Sponsor: None`);
      }
      console.log('');
    }
  } finally {
    client.release();
    await pool.end();
  }
}

checkReferralChains().then(() => process.exit(0)).catch(err => {
  console.error(err);
  process.exit(1);
});
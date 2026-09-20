/**
 * Force-fix AM ranks on production DB:
 * Any user with current_rank = 'AM' who has fewer than 6 direct active SA referrals
 * (via sponsor_id) gets demoted back to 'SA'.
 */
const pool = require('../db');

async function main() {
  console.log('🔌 Connecting to DB...');

  // 1. Get all current AM users
  const amUsers = await pool.query(
    `SELECT id, member_id, name, current_rank, sponsor_id FROM users WHERE current_rank = 'AM' ORDER BY member_id`
  );

  console.log(`\nFound ${amUsers.rows.length} users currently ranked AM:\n`);

  const toFix = [];
  const toKeep = [];

  for (const user of amUsers.rows) {
    // Count how many direct active SAs this user sponsored
    const countRes = await pool.query(
      `SELECT COUNT(*) as cnt FROM users WHERE sponsor_id = $1 AND is_active = true`,
      [user.id]
    );
    const directActiveSAs = parseInt(countRes.rows[0].cnt, 10);

    if (directActiveSAs < 6) {
      toFix.push({ ...user, directActiveSAs });
    } else {
      toKeep.push({ ...user, directActiveSAs });
    }
  }

  console.log(`\n✅ Legitimate AMs (>= 6 direct active SAs):`);
  for (const u of toKeep) {
    console.log(`  ${u.member_id} - ${u.name}: ${u.directActiveSAs} direct active SAs → KEEP AM`);
  }

  console.log(`\n❌ Illegitimate AMs (< 6 direct active SAs) → will demote to SA:`);
  for (const u of toFix) {
    console.log(`  ${u.member_id} - ${u.name}: ${u.directActiveSAs} direct active SAs → DEMOTE to SA`);
  }

  if (toFix.length === 0) {
    console.log('\n  (none to fix)');
    await pool.end();
    return;
  }

  // 2. Demote illegitimate AMs to SA
  const idsToFix = toFix.map(u => u.id);
  await pool.query(
    `UPDATE users SET current_rank = 'SA', updated_at = NOW() WHERE id = ANY($1::int[])`,
    [idsToFix]
  );

  console.log(`\n✅ Successfully demoted ${toFix.length} users from AM → SA on the production DB!`);

  // 3. Final verification
  const finalCheck = await pool.query(
    `SELECT current_rank, COUNT(*) as count FROM users GROUP BY current_rank ORDER BY count DESC`
  );
  console.log('\n📊 Final rank distribution:');
  console.table(finalCheck.rows);

  await pool.end();
}

main().catch(async e => {
  console.error('ERROR:', e.message);
  await pool.end();
  process.exit(1);
});

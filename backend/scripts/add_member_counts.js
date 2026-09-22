/**
 * Migration: Add member count columns for member-based pair matching
 * Run: node scripts/add_member_counts.js
 */
const pool = require('../db');

async function migrate() {
  const client = await pool.connect();
  try {
    console.log('🔄 Adding member count columns for member-based pair matching...');
    
    await client.query('BEGIN');
    
    // Add new columns if they don't exist
    await client.query(`
      ALTER TABLE users 
      ADD COLUMN IF NOT EXISTS left_member_count INT DEFAULT 0,
      ADD COLUMN IF NOT EXISTS right_member_count INT DEFAULT 0,
      ADD COLUMN IF NOT EXISTS is_dormant BOOLEAN DEFAULT false;
      ALTER TABLE daily_pair_log ADD COLUMN IF NOT EXISTS pmi_triggered BOOLEAN DEFAULT false;
      ALTER TABLE daily_pair_log ADD COLUMN IF NOT EXISTS smi_triggered BOOLEAN DEFAULT false;
      ALTER TABLE daily_pair_log ADD COLUMN IF NOT EXISTS attributed_to VARCHAR(20) DEFAULT 'REAL_USER';
      ALTER TABLE daily_pair_log ADD COLUMN IF NOT EXISTS left_count_start INT DEFAULT 0;
      ALTER TABLE daily_pair_log ADD COLUMN IF NOT EXISTS right_count_start INT DEFAULT 0;
      ALTER TABLE daily_pair_log ADD COLUMN IF NOT EXISTS left_count_remaining INT DEFAULT 0;
      ALTER TABLE daily_pair_log ADD COLUMN IF NOT EXISTS right_count_remaining INT DEFAULT 0;
    `);
    
    console.log('✅ Schema updated successfully');
    
    // Calculate initial member counts from tree structure
    console.log('🔄 Calculating initial member counts from tree structure...');
    
    // Reset all counts to 0
    await client.query('UPDATE users SET left_member_count = 0, right_member_count = 0');
    
    // Calculate member counts using direct tree traversal (more reliable than CTE)
    const usersRes = await client.query('SELECT id, member_id, name, left_child_id, right_child_id FROM users WHERE role = \'user\'');
    const userMap = new Map();
    
    // Build parent-child relationships
    for (const userRow of usersRes.rows) {
      userMap.set(userRow.id, userRow);
    }
    
    console.log('🔄 Calculating member counts using tree traversal...');
    
    for (const userRow of usersRes.rows) {
      const userId = userRow.id;
      
      // Count left descendants using BFS
      let leftCount = 0;
      if (userRow.left_child_id) {
        const queue = [userRow.left_child_id];
        const visited = new Set([userRow.left_child_id]);
        
        while (queue.length > 0) {
          const currentId = queue.shift();
          leftCount++;
          
          const currentUser = userMap.get(currentId);
          if (currentUser && currentUser.left_child_id && !visited.has(currentUser.left_child_id)) {
            visited.add(currentUser.left_child_id);
            queue.push(currentUser.left_child_id);
          }
          if (currentUser && currentUser.right_child_id && !visited.has(currentUser.right_child_id)) {
            visited.add(currentUser.right_child_id);
            queue.push(currentUser.right_child_id);
          }
        }
      }
      
      // Count right descendants using BFS
      let rightCount = 0;
      if (userRow.right_child_id) {
        const queue = [userRow.right_child_id];
        const visited = new Set([userRow.right_child_id]);
        
        while (queue.length > 0) {
          const currentId = queue.shift();
          rightCount++;
          
          const currentUser = userMap.get(currentId);
          if (currentUser && currentUser.left_child_id && !visited.has(currentUser.left_child_id)) {
            visited.add(currentUser.left_child_id);
            queue.push(currentUser.left_child_id);
          }
          if (currentUser && currentUser.right_child_id && !visited.has(currentUser.right_child_id)) {
            visited.add(currentUser.right_child_id);
            queue.push(currentUser.right_child_id);
          }
        }
      }
      
      await client.query(
        'UPDATE users SET left_member_count = $1, right_member_count = $2 WHERE id = $3',
        [leftCount, rightCount, userId]
      );
      
      console.log(`👤 User ${userId}: Left ${leftCount}, Right ${rightCount}`);
    }
    
    await client.query('COMMIT');
    
    console.log('✅ Member counts calculated successfully');
    console.log('🎉 Migration completed!');
    
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Migration failed:', err.message);
    throw err;
  } finally {
    client.release();
  }
}

migrate().then(() => process.exit(0)).catch(err => {
  console.error(err);
  process.exit(1);
});
/**
 * Debug member count calculation
 */
const pool = require('../db');

async function debug() {
  try {
    console.log('🔍 Debugging member count calculation...\n');
    
    // Test specific user
    const userRes = await pool.query('SELECT id, member_id, name, left_child_id, right_child_id FROM users WHERE member_id = \'SP0002\'');
    const user = userRes.rows[0];
    console.log('👤 User:', user.member_id, user.name);
    console.log('LeftChild:', user.left_child_id);
    console.log('RightChild:', user.right_child_id);
    
    // Simple test: count children directly
    if (user.left_child_id) {
      const leftChild = await pool.query('SELECT member_id, name FROM users WHERE id = $1', [user.left_child_id]);
      console.log('Left child:', leftChild.rows[0].member_id, leftChild.rows[0].name);
    }
    
    if (user.right_child_id) {
      const rightChild = await pool.query('SELECT member_id, name FROM users WHERE id = $1', [user.right_child_id]);
      console.log('Right child:', rightChild.rows[0].member_id, rightChild.rows[0].name);
    }
    
    // Test recursive CTE manually
    console.log('\n🔍 Testing recursive CTE...');
    const cteTest = await pool.query(`
      WITH RECURSIVE left_tree AS (
        SELECT id FROM users WHERE id = $1
        UNION ALL
        SELECT u.id FROM users u JOIN left_tree lt ON u.parent_id = lt.id AND u.position = 'left'
      ) SELECT COUNT(*) FROM left_tree
    `, [user.id]);
    
    console.log('Total nodes in left tree (including user):', cteTest.rows[0].count);
    console.log('Member count (excluding user):', cteTest.rows[0].count - 1);
    
  } catch (err) {
    console.error('❌ Debug failed:', err.message);
  } finally {
    await pool.end();
  }
}

debug();
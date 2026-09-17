/**
 * Test Member-Based Pair Logic
 * Manual verification before tonight's daily run
 */
const pool = require('../db');

async function testPairLogic() {
  try {
    console.log('🧪 Testing Member-Based Pair Logic...\n');
    
    // Get current state of key users
    const usersRes = await pool.query(`
      SELECT id, member_id, name, left_member_count, right_member_count, 
             left_pv, right_pv, total_pairs, is_active
      FROM users 
      WHERE member_id IN ('BAP0000', 'SP0002', 'SP0003', 'SP0004', 'SP0005', 'SP0006')
      ORDER BY member_id
    `);
    
    console.log('📊 Current User State:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    usersRes.rows.forEach(user => {
      console.log(`👤 ${user.member_id} - ${user.name}`);
      console.log(`   Left: ${user.left_member_count} members (${user.left_pv} PV)`);
      console.log(`   Right: ${user.right_member_count} members (${user.right_pv} PV)`);
      console.log(`   Total Pairs: ${user.total_pairs}`);
      console.log(`   Active: ${user.is_active}`);
      console.log('');
    });
    
    // Test pair calculation logic
    console.log('🧮 Manual Pair Calculation Test:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
    usersRes.rows.forEach(user => {
      if (!user.is_active) return;
      
      const leftCount = parseInt(user.left_member_count) || 0;
      const rightCount = parseInt(user.right_member_count) || 0;
      const leftPV = parseFloat(user.left_pv) || 0;
      const rightPV = parseFloat(user.right_pv) || 0;
      
      // Member-based pair calculation
      const rawPairs = Math.min(leftCount, rightCount);
      const payablePairs = Math.min(rawPairs, 10); // Daily cap
      const amountPaid = payablePairs * 1000;
      
      // Count subtraction
      const leftIsStronger = leftCount >= rightCount;
      const leftRemaining = leftIsStronger ? leftCount - payablePairs : 0;
      const rightRemaining = !leftIsStronger ? rightCount - payablePairs : 0;
      
      // PV carry-forward logic
      let leftPVCarry = 0;
      let rightPVCarry = 0;
      
      if (rawPairs > 10) {
        // Exceeds daily cap
        if (leftIsStronger) {
          rightPVCarry = 0; // Weaker leg PV discarded
          leftPVCarry = leftPV; // Stronger leg PV carries forward
        } else {
          leftPVCarry = 0; // Weaker leg PV discarded
          rightPVCarry = rightPV; // Stronger leg PV carries forward
        }
      } else {
        // Under daily cap
        leftPVCarry = leftPV;
        rightPVCarry = rightPV;
      }
      
      console.log(`👤 ${user.member_id} - ${user.name}:`);
      console.log(`   Raw Pairs: ${rawPairs} (min(${leftCount}, ${rightCount}))`);
      console.log(`   Payable Pairs: ${payablePairs} (cap 10)`);
      console.log(`   Income: ₹${amountPaid}`);
      console.log(`   After Match: Left ${leftRemaining} members, Right ${rightRemaining} members`);
      console.log(`   PV Carry: Left ${leftPVCarry}, Right ${rightPVCarry}`);
      console.log(`   Exceeds Cap: ${rawPairs > 10 ? 'YES' : 'NO'}`);
      console.log('');
    });
    
    console.log('✅ Manual verification complete. Compare these results with system output after daily run.');
    
  } catch (err) {
    console.error('❌ Test failed:', err.message);
  } finally {
    await pool.end();
  }
}

testPairLogic();
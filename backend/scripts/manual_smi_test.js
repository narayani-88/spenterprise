/**
 * Manual SMI calculation test for specific users
 */
const pool = require('../db');

async function manualSMITest() {
  const client = await pool.connect();
  try {
    // Test SP0002 (has 4 pairs = ₹4,000 pair income)
    const user = await client.query('SELECT id, member_id, name, left_member_count, right_member_count, sponsor_id FROM users WHERE member_id=$1', ['SP0002']);
    
    if (user.rows.length > 0) {
      const u = user.rows[0];
      const left = parseInt(u.left_member_count) || 0;
      const right = parseInt(u.right_member_count) || 0;
      const pairs = Math.min(left, right);
      const pairIncome = pairs * 1000;
      
      console.log(`👤 ${u.member_id} - ${u.name}`);
      console.log(`   Left: ${left}, Right: ${right}`);
      console.log(`   Pairs: ${pairs}, Pair Income: ₹${pairIncome}`);
      
      if (pairIncome > 0) {
        console.log(`   📊 SMI Cascade Calculation:`);
        
        let baseAmount = pairIncome;
        let commission = Math.round(baseAmount * 0.20);
        let level = 1;
        let sponsorId = u.sponsor_id;
        let totalSMI = 0;
        
        while (commission >= 1 && sponsorId && baseAmount > 0) {
          const sponsor = await client.query('SELECT id, member_id, name, role, sponsor_id FROM users WHERE id=$1', [sponsorId]);
          if (sponsor.rows.length === 0) break;
          
          const s = sponsor.rows[0];
          console.log(`   Level ${level}: ${s.member_id} - ${s.name} (${s.role})`);
          console.log(`      Commission: ₹${commission} (20% of ₹${baseAmount})`);
          
          totalSMI += commission;
          baseAmount -= commission;
          commission = Math.round(baseAmount * 0.20);
          sponsorId = s.sponsor_id;
          level++;
          
          if (commission <= 0) break;
        }
        
        console.log(`   💰 Total SMI Paid: ₹${totalSMI}`);
        console.log(`   🏦 Company Retained: ₹${baseAmount}`);
      } else {
        console.log(`   No pair income, no SMI cascade`);
      }
    } else {
      console.log('User not found');
    }
    
  } finally {
    client.release();
    await pool.end();
  }
}

manualSMITest().then(() => process.exit(0)).catch(err => {
  console.error(err);
  process.exit(1);
});
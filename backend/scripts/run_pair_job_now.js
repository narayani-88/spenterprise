/**
 * Manual trigger for the daily pair + PMI income job.
 * Run: node backend/scripts/run_pair_job_now.js
 *
 * This is safe to run at any time — it uses the same logic as the
 * midnight cron job and skips users who already got pair income today.
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { runDailyPairJob } = require('../services/incomeEngine');

console.log('═══════════════════════════════════════════════');
console.log('🔄  MANUAL DAILY PAIR + PMI JOB TRIGGER');
console.log('═══════════════════════════════════════════════');
console.log(`⏰  Time: ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`);
console.log('');

runDailyPairJob()
  .then(() => {
    console.log('');
    console.log('✅ Manual pair + PMI job completed successfully!');
    process.exit(0);
  })
  .catch(err => {
    console.error('❌ Job failed:', err.message);
    process.exit(1);
  });

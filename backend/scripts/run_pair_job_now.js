/**
 * Manual trigger for the daily pair + PMI income job.
 * Run: node backend/scripts/run_pair_job_now.js
 *
 * This is safe to run at any time — it uses the same logic as the
 * midnight cron job and skips users who already got pair income today.
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const pool = require('../db');
const { runDailyPairJob } = require('../services/incomeEngine');

console.log('═══════════════════════════════════════════════');
console.log('🔄  MANUAL DAILY PAIR + PMI JOB TRIGGER');
console.log('═══════════════════════════════════════════════');
console.log(`⏰  Time: ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`);
console.log('');

async function main() {
  // 1. Ensure any missing columns on daily_pair_log exist
  try {
    await pool.query(`
      ALTER TABLE daily_pair_log ADD COLUMN IF NOT EXISTS pmi_triggered BOOLEAN DEFAULT false;
      ALTER TABLE daily_pair_log ADD COLUMN IF NOT EXISTS smi_triggered BOOLEAN DEFAULT false;
      ALTER TABLE daily_pair_log ADD COLUMN IF NOT EXISTS attributed_to VARCHAR(20) DEFAULT 'REAL_USER';
      ALTER TABLE daily_pair_log ADD COLUMN IF NOT EXISTS left_count_start INT DEFAULT 0;
      ALTER TABLE daily_pair_log ADD COLUMN IF NOT EXISTS right_count_start INT DEFAULT 0;
      ALTER TABLE daily_pair_log ADD COLUMN IF NOT EXISTS left_count_remaining INT DEFAULT 0;
      ALTER TABLE daily_pair_log ADD COLUMN IF NOT EXISTS right_count_remaining INT DEFAULT 0;
    `);
  } catch (mErr) {
    console.warn('⚠️ Column migration notice:', mErr.message);
  }

  // 2. Execute pair matching & PMI cascade
  await runDailyPairJob();
}

main()
  .then(() => {
    console.log('');
    console.log('✅ Manual pair + PMI job completed successfully!');
    process.exit(0);
  })
  .catch(err => {
    console.error('❌ Job failed:', err.message);
    process.exit(1);
  });

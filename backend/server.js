const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend')));

app.use('/api/auth',  require('./routes/auth'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/user',  require('./routes/users'));
app.use('/api/cms',   require('./routes/cms'));

// Note: /api/admin/run-daily-job is handled by routes/admin.js with proper auth

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, async () => {
  console.log(`\n🚀 MLM Dashboard: http://localhost:${PORT}`);
  console.log(`📊 Admin Login: admin@spenterprise.com / Admin@1234\n`);

  // Schedule daily pair job at midnight (12:00 AM)
  scheduleDailyJob();
});

function scheduleDailyJob() {
  const now      = new Date();
  const midnight = new Date(now);
  midnight.setDate(midnight.getDate() + 1);
  midnight.setHours(0, 1, 0, 0); // 12:01 AM
  const msUntilMidnight = midnight - now;

  console.log(`⏰ Daily pair job scheduled in ${Math.round(msUntilMidnight / 3600000)} hours`);

  setTimeout(async () => {
    const { runDailyPairJob } = require('./services/incomeEngine');
    await runDailyPairJob();
    // Reschedule for next day
    setInterval(async () => {
      await runDailyPairJob();
    }, 24 * 60 * 60 * 1000);
  }, msUntilMidnight);
}

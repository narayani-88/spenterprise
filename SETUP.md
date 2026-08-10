# MLM Network Dashboard — Setup Guide

## Step 1: Install Node.js
Download: https://nodejs.org/ (Choose LTS)  
After install, restart PowerShell.

## Step 2: Install PostgreSQL
Download: https://www.postgresql.org/download/windows/  
During install, set a password for `postgres` user.

## Step 3: Create the database
Open pgAdmin or psql and run:
```sql
CREATE DATABASE mlm_dashboard;
```

## Step 4: Edit .env
Open `backend/.env` and set your PostgreSQL password:
```
DB_PASSWORD=your_password_here
```

## Step 5: Install dependencies
```bash
cd backend
npm install
```

## Step 6: Seed (creates tables + dummy data)
```bash
npm run seed
```

## Step 7: Start the server
```bash
npm run dev
```

## Step 8: Open browser
http://localhost:5000

---

## Login Credentials

| Role | Email | Password | Notes |
|------|-------|----------|-------|
| 🏢 Company | admin@spenterprise.com | Admin@1234 | Full admin access |
| 👤 Amit Sharma | amit@example.com | Pass@123 | ZM rank, 5 pairs |
| 🏆 Rohan Shah | rohan@example.com | Pass@123 | AM rank, 10 pairs — SMI triggered! |
| 🔴 Rahul Gupta | rahul@example.com | Pass@123 | Inactive (₹5,000/₹12,500) |

---

## Business Rules (v2 — Confirmed)

| Rule | Detail |
|------|--------|
| **Activation** | ₹12,500 → RED to GREEN. Company must approve UTR deposit. |
| **PV System** | ₹12,500 = 1 PV. Activation adds 1 PV up the entire ancestor chain. |
| **Daily Pairs** | Midnight: match min(left_pv, right_pv). Cap = 10 pairs/day = ₹10,000. |
| **Carry/Flush** | Stronger leg PV carries to next day. Weaker leg PV is **flushed (grey/lost)**. |
| **Referral Income** | ₹2,000 one-time flat. Unlimited uses. |
| **SMI Family Bonus** | Triggers ONLY when daily 10-pair cap is hit. 20% cascades up sponsor chain until <₹1 → remainder to company. |
| **Rank Ladder** | 11 tiers from SA → CGM based on AM count in downline. Auto-recalculates on each activation. |
| **Non-Working Income** | Recurring milestone payouts starting at AM rank (6 AMs = ₹2.5L, etc.) |
| **KYC** | Submitted at registration. Approved from company admin dashboard. |
| **UTR Cross-check** | Submitted UTR must exactly match company-assigned UTR. |

## Daily Pair Job
Runs automatically at midnight. Can also be triggered manually from admin dashboard → **⚡ Run Daily Job**.

## Pending (Phase 1.5 — after papa confirms)
- Non-Working Income recurrence frequency
- Jackpot reward amounts (6/36/216 AMs)
- Death Support / Mediclaim eligibility period
- CLM (CGM monthly income) calculation formula

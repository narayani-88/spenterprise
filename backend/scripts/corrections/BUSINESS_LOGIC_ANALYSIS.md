# Business Logic Analysis - MEGA_ACCOUNT

## Current Code Understanding (from incomeEngine.js comments):

```
Money Flow:
  1. Every rupee enters the MEGA_ACCOUNT first (deposit approval)
  2. When income is earned, it's tagged to either:
     - USER_PAYABLE wallet (if earning ID is REAL_USER) → full gross amount, no TDS
     - COMPANY_EARNED wallet (if earning ID is COMPANY_PLACED) → company profit
  3. TDS (5%) + NWI (10%) are deducted ONLY at withdrawal time
  4. Mega Account balance = Σ User Wallets + Company Earned + already withdrawn
```

## Your Expected Calculation:

```
Total Deposits: ₹200,000
Referral Income (16 active × ₹2,000): ₹32,000
Pair Income: ₹10,000
Withdrawal: ₹2,000
Expected MEGA_ACCOUNT: ₹200,000 - ₹32,000 - ₹10,000 - ₹2,000 = ₹156,000
```

## The Discrepancy:

**Code says:** "Mega Account balance = Σ User Wallets + Company Earned + already withdrawn"
**You say:** MEGA_ACCOUNT = Deposits - (Referral Income + Pair Income + Withdrawal)

These are fundamentally different formulas.

## Questions Before Any Code Changes:

1. **What is MEGA_ACCOUNT supposed to represent?**
   - Option A: Company treasury balance after all payouts (your calculation)
   - Option B: Total cash that has ever entered the system (deposits only)
   - Option C: Sum of all wallets + withdrawals (code comment)

2. **When should MEGA_ACCOUNT be debited?**
   - Option A: Never (only at withdrawal time)
   - Option B: When income is credited to users (what I added)
   - Option C: Something else

3. **Where should payouts come from?**
   - Option A: Directly from MEGA_ACCOUNT when paid
   - Option B: From a separate pool, MEGA_ACCOUNT just tracks deposits
   - Option C: Something else

4. **Should I roll back my corrections?**
   - I made 2 corrections to Railway production:
     - Debited ₹6,000 from MEGA_ACCOUNT
     - Moved ₹16,000 from MEGA_ACCOUNT to COMPANY_EARNED
   - Should I undo these to restore the original state?

**I will NOT make any code changes until you clarify the correct business logic.**

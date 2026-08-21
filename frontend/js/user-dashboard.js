// User Dashboard JS
requireAuth('user');

const user = getUser();
let dashData = null;
let userTreeRenderer = null;

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('user-avatar').textContent = user.name[0].toUpperCase();
  document.getElementById('user-name-pill').textContent = user.name;
  document.getElementById('user-company-name').textContent = 'Book Apna Plot';
  document.getElementById('user-ref-badge').textContent = user.referral_code || 'Member';
  loadDashboard();
  switchPage('dashboard');
});

async function loadDashboard() {
  try {
    dashData = await apiCall('GET', '/user/dashboard');

    document.getElementById('page-sub').textContent = `Referral Code: ${dashData.referral_code}`;

    // Account status badge & Source Type badge
    const badge = document.getElementById('account-status-badge');
    const sourceBadge = dashData.source_type === 'COMPANY_PLACED' 
      ? '<span class="badge badge-gold" style="margin-right:6px">🏢 Company Placed ID</span>'
      : '<span class="badge badge-purple" style="margin-right:6px">👤 Real Associate ID</span>';
    if (dashData.is_active) {
      badge.innerHTML = sourceBadge + '<span class="badge badge-green"><span class="status-dot green" style="margin-right:4px"></span>Active Account</span>';
    } else {
      badge.innerHTML = sourceBadge + '<span class="badge badge-red"><span class="status-dot red" style="margin-right:4px"></span>Inactive</span>';
      document.getElementById('activation-banner').style.display = 'block';
    }

    if (dashData.milestone_triggered) {
      document.getElementById('milestone-banner').style.display = 'block';
    }

    renderUserStats();
    renderWalletOverview();
    renderSlotOverview();
    loadFundHistory();
    renderAddMemberSlots();
  } catch (err) {
    showToast('Failed to load dashboard: ' + err.message, 'error');
  }
}

function renderUserStats() {
  const d = dashData;
  const progress = Math.min((parseFloat(d.total_deposited) / 12500) * 100, 100).toFixed(0);

  document.getElementById('user-stats-grid').innerHTML = `
    <div class="stat-card gold">
      <span class="stat-icon">💰</span>
      <div class="stat-value gold">${formatRupee(d.wallet_balance)}</div>
      <div class="stat-label">Available Wallet</div>
    </div>
    <div class="stat-card red">
      <span class="stat-icon">⏳</span>
      <div class="stat-value red">${formatRupee(d.pending_balance)}</div>
      <div class="stat-label">Pending Income</div>
    </div>
    <div class="stat-card green">
      <span class="stat-icon">🤝</span>
      <div class="stat-value green">${d.pair_count}</div>
      <div class="stat-label">Total Pairs ${d.milestone_triggered ? '🏆' : ''}</div>
    </div>
    <div class="stat-card purple">
      <span class="stat-icon">👥</span>
      <div class="stat-value" style="color:var(--purple-light)">${d.downline_count || 0}</div>
      <div class="stat-label">Total Downline</div>
    </div>
    <div class="stat-card green">
      <span class="stat-icon">🤝</span>
      <div class="stat-value green">${formatRupee(d.total_pair_earned)}</div>
      <div class="stat-label">Pair Income Earned</div>
    </div>
    <div class="stat-card purple">
      <span class="stat-icon">🔗</span>
      <div class="stat-value" style="color:var(--purple-light)">${formatRupee(d.total_referral_earned)}</div>
      <div class="stat-label">Referral Income</div>
    </div>
    <div class="stat-card gold">
      <span class="stat-icon">🏆</span>
      <div class="stat-value gold">${formatRupee(d.total_milestone_earned)}</div>
      <div class="stat-label">Milestone Commission</div>
    </div>
    <div class="stat-card purple">
      <span class="stat-icon">🏠</span>
      <div class="stat-value" style="color:var(--purple-light)">${formatRupee(d.total_smi_earned || 0)}</div>
      <div class="stat-label">SMI Family Bonus</div>
    </div>
    <div class="stat-card ${d.is_active ? 'green' : 'red'}">
      <span class="stat-icon">📈</span>
      <div class="stat-value ${d.is_active ? 'green' : 'red'}">${progress}%</div>
      <div class="stat-label">Activation (${formatRupee(d.total_deposited)} / ₹12,500)</div>
    </div>
  `;
}

function renderWalletOverview() {
  const d = dashData;
  const progress = Math.min((parseFloat(d.total_deposited) / 12500) * 100, 100);

  document.getElementById('wallet-overview').innerHTML = `
    <div style="margin-bottom:20px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <span style="font-size:13px;color:var(--text-secondary)">Activation Progress</span>
        <span style="font-size:13px;font-weight:700;color:${d.is_active ? 'var(--green-light)' : 'var(--gold)'}">${formatRupee(d.total_deposited)} / ₹12,500</span>
      </div>
      <div class="activation-bar"><div class="activation-fill" style="width:${progress}%"></div></div>
      <div style="font-size:11px;color:var(--text-muted);margin-top:4px">${d.is_active ? '✅ Account Activated' : `₹${(12500 - parseFloat(d.total_deposited)).toLocaleString('en-IN')} more needed`}</div>
    </div>

    <div class="income-grid">
      <div class="income-item">
        <div class="income-amount" style="color:var(--gold)">${formatRupee(d.wallet_balance)}</div>
        <div class="income-label">💰 Available</div>
      </div>
      <div class="income-item">
        <div class="income-amount" style="color:var(--red-light)">${formatRupee(d.pending_balance)}</div>
        <div class="income-label">⏳ Pending</div>
      </div>
      <div class="income-item">
        <div class="income-amount" style="color:var(--green-light)">${formatRupee(d.total_pair_earned)}</div>
        <div class="income-label">🤝 From Pairs</div>
      </div>
      <div class="income-item">
        <div class="income-amount" style="color:var(--purple-light)">${formatRupee(d.total_referral_earned)}</div>
        <div class="income-label">🔗 Referral</div>
      </div>
    </div>

    ${(d.total_milestone_earned > 0 || d.total_smi_earned > 0) ? `
      <div style="margin-top:12px;display:flex;gap:10px">
        <div style="flex:1;background:rgba(245,158,11,0.06);border:1px solid rgba(245,158,11,0.15);border-radius:10px;padding:10px;text-align:center">
          <div style="font-size:16px">🏆</div>
          <div style="font-weight:700;color:var(--gold);font-size:13px">${formatRupee(d.total_milestone_earned)}</div>
          <div style="font-size:10px;color:var(--text-muted)">Milestone Bonus</div>
        </div>
        <div style="flex:1;background:rgba(99,102,241,0.06);border:1px solid rgba(99,102,241,0.15);border-radius:10px;padding:10px;text-align:center">
          <div style="font-size:16px">🏠</div>
          <div style="font-weight:700;color:var(--purple-light);font-size:13px">${formatRupee(d.total_smi_earned || 0)}</div>
          <div style="font-size:10px;color:var(--text-muted)">SMI Family Bonus</div>
        </div>
      </div>` : ''}

    <div style="margin-top:16px;padding:12px;background:rgba(255,255,255,0.03);border-radius:10px;font-size:12px;color:var(--text-secondary)">
      <div style="font-weight:600;color:var(--text-primary);margin-bottom:6px">Your Referral Code</div>
      <div style="font-size:18px;font-family:monospace;font-weight:700;color:var(--purple-light)">${d.referral_code}</div>
      <div style="margin-top:4px">Share this to earn ₹2,000 per referral</div>
    </div>
  `;
}

function renderSlotOverview() {
  const d = dashData;
  const leftPV = parseFloat(d.left_pv) || 0;
  const rightPV = parseFloat(d.right_pv) || 0;

  let leftStatusHTML = `<span style="font-size:11px;color:var(--text-secondary)">PV: <strong>${leftPV}</strong></span>`;
  let rightStatusHTML = `<span style="font-size:11px;color:var(--text-secondary)">PV: <strong>${rightPV}</strong></span>`;

  if (leftPV === 0 && rightPV > 0) {
    leftStatusHTML = `<div style="font-size:11px;color:#9ca3af;margin-top:4px" title="Weaker leg knocked off on 10-pair match">Weaker Leg: <strong style="text-decoration:line-through;color:#9ca3af">0 PV</strong> <span class="badge" style="background:rgba(156,163,175,0.2);color:#9ca3af;font-size:9px">Flushed</span></div>`;
    rightStatusHTML = `<div style="font-size:11px;color:var(--green-light);margin-top:4px">Greater Leg: <strong>${rightPV} PV</strong> <span class="badge badge-green" style="font-size:9px">Carry Forward</span></div>`;
  } else if (rightPV === 0 && leftPV > 0) {
    leftStatusHTML = `<div style="font-size:11px;color:var(--green-light);margin-top:4px">Greater Leg: <strong>${leftPV} PV</strong> <span class="badge badge-green" style="font-size:9px">Carry Forward</span></div>`;
    rightStatusHTML = `<div style="font-size:11px;color:#9ca3af;margin-top:4px" title="Weaker leg knocked off on 10-pair match">Weaker Leg: <strong style="text-decoration:line-through;color:#9ca3af">0 PV</strong> <span class="badge" style="background:rgba(156,163,175,0.2);color:#9ca3af;font-size:9px">Flushed</span></div>`;
  } else if (leftPV > 0 || rightPV > 0) {
    if (leftPV === rightPV) {
      leftStatusHTML += ` <span class="badge badge-gold" style="font-size:10px">Balanced</span>`;
      rightStatusHTML += ` <span class="badge badge-gold" style="font-size:10px">Balanced</span>`;
    } else if (leftPV < rightPV) {
      leftStatusHTML = `<div style="font-size:11px;color:#9ca3af;margin-top:4px">Lesser Leg: <strong style="text-decoration:line-through;color:#9ca3af">${leftPV} PV</strong> <span class="badge" style="background:rgba(156,163,175,0.2);color:#9ca3af;font-size:9px">Flushed</span></div>`;
      rightStatusHTML = `<div style="font-size:11px;color:var(--green-light);margin-top:4px">Greater Leg: <strong>${rightPV} PV</strong> <span class="badge badge-green" style="font-size:9px">Carry Forward</span></div>`;
    } else {
      leftStatusHTML = `<div style="font-size:11px;color:var(--green-light);margin-top:4px">Greater Leg: <strong>${leftPV} PV</strong> <span class="badge badge-green" style="font-size:9px">Carry Forward</span></div>`;
      rightStatusHTML = `<div style="font-size:11px;color:#9ca3af;margin-top:4px">Lesser Leg: <strong style="text-decoration:line-through;color:#9ca3af">${rightPV} PV</strong> <span class="badge" style="background:rgba(156,163,175,0.2);color:#9ca3af;font-size:9px">Flushed</span></div>`;
    }
  }

  document.getElementById('slot-overview').innerHTML = `
    <div style="margin-bottom:16px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <span style="font-size:13px;color:var(--text-secondary);font-weight:600">Network Slots & Point Volume (PV)</span>
        <span style="font-size:11px;color:var(--text-muted)">Daily Cap: 10 pairs</span>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div style="background:${d.left_child_name ? 'rgba(16,185,129,0.08)' : 'rgba(99,102,241,0.06)'};border:1px dashed ${d.left_child_name ? 'rgba(16,185,129,0.3)' : 'rgba(99,102,241,0.3)'};border-radius:12px;padding:14px;text-align:center">
          <div style="font-size:24px;margin-bottom:4px">${d.left_child_name ? '👤' : '➕'}</div>
          <div style="font-size:11px;text-transform:uppercase;color:var(--purple-light);font-weight:700;margin-bottom:4px">LEFT SLOT</div>
          ${d.left_child_name
            ? `<div style="font-weight:600;font-size:13px">${d.left_child_name}</div>
               <div class="badge ${d.left_child_active ? 'badge-green' : 'badge-red'}" style="margin-top:4px">${d.left_child_active ? 'Active' : 'Inactive'}</div>
               ${leftStatusHTML}`
            : `<div style="font-size:12px;color:var(--text-muted)">Empty</div>
               <button class="btn btn-ghost btn-sm" style="margin-top:8px" onclick="document.getElementById('am-position').value='left';switchPage('add-member')">Add</button>`
          }
        </div>
        <div style="background:${d.right_child_name ? 'rgba(16,185,129,0.08)' : 'rgba(245,158,11,0.06)'};border:1px dashed ${d.right_child_name ? 'rgba(16,185,129,0.3)' : 'rgba(245,158,11,0.3)'};border-radius:12px;padding:14px;text-align:center">
          <div style="font-size:24px;margin-bottom:4px">${d.right_child_name ? '👤' : '➕'}</div>
          <div style="font-size:11px;text-transform:uppercase;color:var(--gold);font-weight:700;margin-bottom:4px">RIGHT SLOT</div>
          ${d.right_child_name
            ? `<div style="font-weight:600;font-size:13px">${d.right_child_name}</div>
               <div class="badge ${d.right_child_active ? 'badge-green' : 'badge-red'}" style="margin-top:4px">${d.right_child_active ? 'Active' : 'Inactive'}</div>
               ${rightStatusHTML}`
            : `<div style="font-size:12px;color:var(--text-muted)">Empty</div>
               <button class="btn btn-ghost btn-sm" style="margin-top:8px" onclick="document.getElementById('am-position').value='right';switchPage('add-member')">Add</button>`
          }
        </div>
      </div>
    </div>

    ${d.left_child_name && d.right_child_name ? `
      <div style="background:rgba(16,185,129,0.08);border:1px solid rgba(16,185,129,0.2);border-radius:10px;padding:12px;text-align:center">
        <div style="color:var(--green-light);font-weight:700">✅ Pair Formed!</div>
        <div style="font-size:12px;color:var(--text-secondary)">Weaker leg flushed (knocked off), Greater leg carry forward to next cap</div>
      </div>` : `
      <div style="background:rgba(245,158,11,0.06);border:1px solid rgba(245,158,11,0.15);border-radius:10px;padding:12px">
        <div style="font-size:12px;color:var(--text-secondary)">
          <div style="font-weight:600;color:var(--gold);margin-bottom:4px">💡 Binary Pair Matching Rule</div>
          Max 10 pairs/day. Weaker leg flushes to 0 (grey), stronger leg carries forward (green).
        </div>
      </div>`}

    <div style="margin-top:12px;font-size:12px;color:var(--text-secondary)">
      <strong style="color:var(--text-primary)">Parent:</strong> ${d.parent_name || 'Company (Root)'}
    </div>
  `;
}

function renderAddMemberSlots() {
  if (!dashData) return;
  const leftFree = !dashData.left_child_name;
  const rightFree = !dashData.right_child_name;

  document.getElementById('add-member-slots').innerHTML = `
    <div style="display:flex;gap:10px;margin-bottom:16px">
      <div style="flex:1;padding:12px;border-radius:10px;text-align:center;background:${leftFree ? 'rgba(99,102,241,0.08)' : 'rgba(245,158,11,0.06)'};border:1px solid ${leftFree ? 'rgba(99,102,241,0.3)' : 'rgba(245,158,11,0.25)'}">
        <div style="font-size:11px;font-weight:700;color:${leftFree ? 'var(--purple-light)' : 'var(--gold)'};text-transform:uppercase">Left Leg Placement</div>
        <div style="font-size:12px;margin-top:4px">${leftFree ? '🟢 Direct Left Available' : `🔄 Spillover (${dashData.left_child_name})`}</div>
      </div>
      <div style="flex:1;padding:12px;border-radius:10px;text-align:center;background:${rightFree ? 'rgba(99,102,241,0.08)' : 'rgba(245,158,11,0.06)'};border:1px solid ${rightFree ? 'rgba(99,102,241,0.3)' : 'rgba(245,158,11,0.25)'}">
        <div style="font-size:11px;font-weight:700;color:${rightFree ? 'var(--purple-light)' : 'var(--gold)'};text-transform:uppercase">Right Leg Placement</div>
        <div style="font-size:12px;margin-top:4px">${rightFree ? '🟢 Direct Right Available' : `🔄 Spillover (${dashData.right_child_name})`}</div>
      </div>
    </div>`;

  // Enable all position options for spillover
  const posEl = document.getElementById('am-position');
  if (posEl) {
    Array.from(posEl.options).forEach(opt => { opt.disabled = false; });
  }

  const alertEl = document.getElementById('add-member-alert');
  if (alertEl) {
    alertEl.innerHTML = `
      <div class="alert alert-info" style="font-size:12px;padding:10px 14px">
        ✨ <strong>Spillover Active:</strong> Selecting a leg (Left/Right) will place the member in your downline tree. You receive the <strong>₹2,000 Referral Income</strong> for every member you add!
      </div>`;
  }
}

// Tree
async function renderUserTree() {
  try {
    const tree = await apiCall('GET', '/user/tree');
    if (!userTreeRenderer) {
      userTreeRenderer = new BinaryTreeRenderer('user-tree-svg', {
        nodeWidth: 155, nodeHeight: 66, levelGap: 95, siblingGap: 24
      });
    }
    userTreeRenderer.render(tree);
  } catch (err) {
    showToast('Failed to load tree', 'error');
  }
}

// Income history
async function loadIncome() {
  try {
    const [txns, dashSummary] = await Promise.all([
      apiCall('GET', '/user/transactions'),
      apiCall('GET', '/user/dashboard')
    ]);

    const totalIncome = parseFloat(dashSummary.wallet_balance) + parseFloat(dashSummary.pending_balance);
    const pairsLeft = Math.max(0, 10 - parseInt(dashSummary.pair_count));

    document.getElementById('income-summary-grid').innerHTML = `
      <div class="income-item">
        <div class="income-amount" style="color:var(--gold)">${formatRupee(dashSummary.total_pair_earned)}</div>
        <div class="income-label">🤝 Total Pair Income</div>
      </div>
      <div class="income-item">
        <div class="income-amount" style="color:var(--purple-light)">${formatRupee(dashSummary.total_referral_earned)}</div>
        <div class="income-label">🔗 Referral Income</div>
      </div>
      <div class="income-item">
        <div class="income-amount" style="color:var(--gold-light)">${formatRupee(dashSummary.total_milestone_earned)}</div>
        <div class="income-label">🏆 Milestone Bonus</div>
      </div>
      <div class="income-item">
        <div class="income-amount" style="color:var(--purple-light)">${formatRupee(dashSummary.total_smi_earned || 0)}</div>
        <div class="income-label">🏠 SMI Family Bonus</div>
      </div>
      <div class="income-item">
        <div class="income-amount" style="color:${pairsLeft === 0 ? 'var(--green-light)' : 'var(--blue-light)'}">${pairsLeft === 0 ? 'Done! 🏆' : pairsLeft + ' more'}</div>
        <div class="income-label">Pairs to Milestone (10)</div>
      </div>
    `;

    const typeColor = { pair_income: 'badge-green', referral_income: 'badge-purple', milestone_commission: 'badge-gold', smi_family_bonus: 'badge-gold', deposit: 'badge-blue' };
    const typeLabel = { pair_income: '🤝 Pair', referral_income: '🔗 Referral', milestone_commission: '🏆 Milestone', smi_family_bonus: '🏠 SMI Family', deposit: '💳 Deposit' };

    document.getElementById('income-table-body').innerHTML = txns.length ? txns.map(t => {
      const it = t.income_type || t.type;
      return `
      <tr>
        <td style="font-size:12px;color:var(--text-secondary);white-space:nowrap">${formatDateTime(t.created_at)}</td>
        <td><span class="badge ${typeColor[it] || 'badge-gray'}">${typeLabel[it] || t.income_label || it}</span></td>
        <td style="font-weight:700;color:var(--gold)">${formatRupee(t.net_amount || t.amount)}</td>
        <td><span class="badge ${t.status === 'credited' ? 'badge-green' : 'badge-red'}">${t.status}</span></td>
        <td style="font-size:12px;color:var(--text-secondary)">${t.description || '—'}</td>
      </tr>`;
    }).join('') : '<tr><td colspan="5"><div class="empty-state"><div class="icon">📭</div><p>No transactions yet</p></div></td></tr>';
  } catch (err) {
    showToast('Failed to load income', 'error');
  }
}

// Add member
function generateAmPassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789@#!';
  let pwd = '';
  for (let i = 0; i < 10; i++) pwd += chars[Math.floor(Math.random() * chars.length)];
  const el = document.getElementById('am-password');
  if (el) el.value = pwd;
}

async function submitAddMember() {
  const alertEl = document.getElementById('add-member-alert');
  alertEl.innerHTML = '';
  const body = {
    name: document.getElementById('am-name').value,
    email: document.getElementById('am-email').value,
    phone: document.getElementById('am-phone').value,
    position: document.getElementById('am-position').value,
    referral_code_used: document.getElementById('am-refcode').value,
    password: document.getElementById('am-password').value
  };
  if (!body.name || !body.email || !body.position || !body.password) {
    alertEl.innerHTML = '<div class="alert alert-error">⚠️ Please fill all required fields</div>';
    return;
  }
  try {
    const tempPassword = document.getElementById('am-password').value;
    const res = await apiCall('POST', '/user/add-member', body);
    showToast(`${res.user.name} added! Member ID: ${res.user.member_id}`, 'success');
    document.getElementById('add-member-form').reset();
    generateAmPassword(); // generate fresh password for next member
    alertEl.innerHTML = `
      <div class="alert alert-success">
        ✅ Member added successfully!<br>
        <strong>Member ID:</strong> ${res.user.member_id}<br>
        <strong>Name:</strong> ${res.user.name}<br>
        <strong>Temp Password:</strong> <span style="font-family:monospace;font-weight:700;font-size:15px;background:rgba(245,158,11,0.12);padding:2px 8px;border-radius:6px;color:var(--gold)">${tempPassword}</span><br>
        <span style="font-size:11px;opacity:0.7">⚠️ Share this with the member. This will not be shown again.</span>
      </div>`;
    loadDashboard();
  } catch (err) {
    alertEl.innerHTML = `<div class="alert alert-error">⚠️ ${err.message}</div>`;
  }
}

// ── UTR Validation (client-side mirror of backend rule) ───────────────────────
function isValidUTR(utr) {
  if (!utr) return false;
  const cleaned = utr.trim();
  // 10-22 alphanumeric characters only (letters + digits, no special chars)
  return /^[A-Za-z0-9]{10,22}$/.test(cleaned);
}

// Real-time UTR input enforcement: block special characters as user types
document.addEventListener('DOMContentLoaded', () => {
  const utrInput = document.getElementById('fund-utr');
  if (utrInput) {
    utrInput.addEventListener('input', function () {
      // Strip any non-alphanumeric characters immediately
      const cleaned = this.value.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
      if (this.value !== cleaned) this.value = cleaned;

      const hint = document.getElementById('utr-hint');
      if (!hint) return;
      const len = cleaned.length;
      if (len === 0) {
        hint.textContent = '';
        hint.style.color = 'var(--text-muted)';
      } else if (len < 10) {
        hint.textContent = `⚠️ Too short (${len}/10 minimum). Only letters & digits allowed.`;
        hint.style.color = 'var(--red-light)';
      } else if (len > 22) {
        hint.textContent = `⚠️ Too long (${len}/22 maximum).`;
        hint.style.color = 'var(--red-light)';
      } else {
        hint.textContent = `✅ Valid UTR format (${len} characters)`;
        hint.style.color = 'var(--green-light)';
      }
    });

    utrInput.addEventListener('paste', function (e) {
      e.preventDefault();
      const pasted = (e.clipboardData || window.clipboardData).getData('text');
      const cleaned = pasted.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
      this.value = cleaned;
      this.dispatchEvent(new Event('input'));
    });
  }
}, { once: true });

// Add fund
async function submitFund() {
  const alertEl = document.getElementById('add-fund-alert');
  alertEl.innerHTML = '';
  const amount = document.getElementById('fund-amount').value;
  const utr = (document.getElementById('fund-utr').value || '').trim().toUpperCase();

  if (!amount) {
    alertEl.innerHTML = '<div class="alert alert-error">⚠️ Please enter the deposit amount</div>';
    return;
  }
  if (!utr) {
    alertEl.innerHTML = '<div class="alert alert-error">⚠️ Please enter your UTR / Transaction Reference number</div>';
    return;
  }
  if (!isValidUTR(utr)) {
    alertEl.innerHTML = `<div class="alert alert-error">
      ⚠️ <strong>Invalid UTR number.</strong><br>
      UTR must be <strong>10 to 22 characters</strong> long and contain <strong>only letters and digits</strong> (no spaces, hyphens, or special characters).
      <br><small>Example: <code>SBIN0000${Math.floor(10000000 + Math.random() * 90000000)}</code></small>
    </div>`;
    document.getElementById('fund-utr').focus();
    return;
  }

  const parsedAmount = parseFloat(amount);
  if (isNaN(parsedAmount) || parsedAmount <= 0) {
    alertEl.innerHTML = '<div class="alert alert-error">⚠️ Please enter a valid deposit amount</div>';
    return;
  }

  try {
    const res = await apiCall('POST', '/user/deposit', { amount: parsedAmount, utr_number: utr });
    showToast('Deposit submitted for verification!', 'success');
    alertEl.innerHTML = `<div class="alert alert-success">
      ✅ <strong>Deposit submitted successfully!</strong><br>
      UTR: <code style="font-family:monospace;background:rgba(16,185,129,0.1);padding:2px 6px;border-radius:4px">${utr}</code><br>
      <span style="font-size:12px">Awaiting company verification. You'll be notified upon approval.</span>
    </div>`;
    document.getElementById('add-fund-form').reset();
    // Clear the UTR hint
    const hint = document.getElementById('utr-hint');
    if (hint) hint.textContent = '';
    loadFundHistory();
  } catch (err) {
    alertEl.innerHTML = `<div class="alert alert-error">⚠️ ${err.message}</div>`;
  }
}

async function loadFundHistory() {
  try {
    const deposits = await apiCall('GET', '/user/deposits');
    document.getElementById('fund-history').innerHTML = deposits.length ? `
      <div class="table-wrapper">
        <table>
          <thead><tr><th>Date</th><th>Amount</th><th>UTR</th><th>Status</th></tr></thead>
          <tbody>${deposits.map(d => `
            <tr>
              <td style="font-size:12px">${formatDateTime(d.created_at)}</td>
              <td style="font-weight:700;color:var(--gold)">${formatRupee(d.amount)}</td>
              <td style="font-family:monospace;font-size:12px">${d.utr_number}</td>
              <td><span class="badge ${d.status === 'approved' ? 'badge-green' : d.status === 'rejected' ? 'badge-red' : 'badge-gold'}">${d.status}</span></td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>` : '<div class="empty-state" style="padding:24px"><div class="icon">📭</div><p>No deposits yet</p></div>';
  } catch (err) {}
}

// Change password
async function submitChangePassword() {
  const alertEl = document.getElementById('settings-alert');
  const np = document.getElementById('new-pass').value;
  const cp = document.getElementById('conf-pass').value;
  alertEl.innerHTML = '';
  if (np !== cp) {
    alertEl.innerHTML = '<div class="alert alert-error">⚠️ Passwords do not match</div>';
    return;
  }
  try {
    await apiCall('POST', '/auth/change-password', {
      current_password: document.getElementById('curr-pass').value,
      new_password: np
    });
    showToast('Password changed successfully!', 'success');
    document.getElementById('settings-form').reset();
    alertEl.innerHTML = '<div class="alert alert-success">✅ Password updated successfully</div>';
  } catch (err) {
    alertEl.innerHTML = `<div class="alert alert-error">⚠️ ${err.message}</div>`;
  }
}

function toggleMobileSidebar() {
  const sidebar = document.getElementById('sidebar');
  const backdrop = document.getElementById('sidebar-backdrop');
  if (sidebar) sidebar.classList.toggle('open');
  if (backdrop) backdrop.classList.toggle('show');
}

// ── WITHDRAWAL REQUEST LOGIC ──────────────────────────────────────────────────
function prepareWithdrawalPage() {
  if (!dashData) return;
  const balEl = document.getElementById('withdraw-available-bal');
  if (balEl) balEl.textContent = formatRupee(dashData.wallet_balance || 0);
  calculateDeductions();
  loadUserWithdrawals();
}

function calculateDeductions() {
  const amtInput = document.getElementById('withdraw-amount');
  const breakdown = document.getElementById('deduction-breakdown');
  if (!amtInput || !breakdown) return;

  const amt = parseFloat(amtInput.value || 0);
  if (amt <= 0 || isNaN(amt)) {
    breakdown.style.display = 'none';
    return;
  }

  // Statutory Tax Deduction (TDS): 5%
  // NWI / S.A.C.F is an associate monthly benefit stream (not withheld on cash withdrawal unless explicitly enabled)
  const tds = (amt * 0.05).toFixed(2);
  const nwi = (0).toFixed(2);
  const net = (amt - tds).toFixed(2);

  document.getElementById('calc-requested').textContent = formatRupee(amt);
  document.getElementById('calc-tds').textContent = `-${formatRupee(tds)}`;
  const nwiEl = document.getElementById('calc-nwi');
  if (nwiEl) nwiEl.textContent = `₹0.00 (Monthly Benefit)`;
  document.getElementById('calc-net').textContent = formatRupee(net);
  breakdown.style.display = 'block';
}

async function submitWithdrawalRequest() {
  const alertEl = document.getElementById('withdraw-alert');
  const btn = document.getElementById('withdraw-submit-btn');
  const amtInput = document.getElementById('withdraw-amount');
  if (!alertEl || !amtInput) return;
  alertEl.innerHTML = '';

  const amt = parseFloat(amtInput.value);
  if (isNaN(amt) || amt <= 0) {
    alertEl.innerHTML = '<div class="alert alert-error">⚠️ Enter a valid positive withdrawal amount</div>';
    return;
  }

  btn.disabled = true;
  try {
    const res = await apiCall('POST', '/user/withdraw', { amount: amt });
    showToast(res.message, 'success');
    alertEl.innerHTML = `<div class="alert alert-success">✅ ${res.message}</div>`;
    amtInput.value = '';
    calculateDeductions();
    loadDashboard();
    loadUserWithdrawals();
  } catch (err) {
    alertEl.innerHTML = `<div class="alert alert-error">⚠️ ${err.message}</div>`;
  } finally { btn.disabled = false; }
}

async function loadUserWithdrawals() {
  const tbody = document.getElementById('user-withdrawals-tbody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="7"><div class="loading"><div class="spinner"></div></div></td></tr>';
  try {
    const rows = await apiCall('GET', '/user/withdrawals');
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:24px;color:var(--text-muted)">No withdrawal history found.</td></tr>';
      return;
    }

    tbody.innerHTML = rows.map(w => `
      <tr>
        <td style="font-size:12px;color:var(--text-secondary);white-space:nowrap">${formatDateTime(w.created_at)}</td>
        <td style="font-weight:700;color:var(--text-primary)">${formatRupee(w.requested_amount)}</td>
        <td style="color:var(--red-light)">-${formatRupee(w.tds_amount)} <span style="font-size:10px">(5% TDS)</span></td>
        <td style="color:var(--text-muted)">${parseFloat(w.nwi_amount || 0) > 0 ? '-' + formatRupee(w.nwi_amount) : '₹0.00'}</td>
        <td style="font-weight:800;color:var(--green-light)">${formatRupee(w.net_amount)}</td>
        <td><span class="badge ${w.status === 'approved' ? 'badge-green' : w.status === 'rejected' ? 'badge-red' : 'badge-gold'}">${w.status.toUpperCase()}</span></td>
        <td style="font-size:11px;color:var(--text-secondary)">${w.notes || '—'}</td>
      </tr>
    `).join('');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="7" style="color:var(--red-light)">⚠️ ${err.message}</td></tr>`;
  }
}

// Page switching with lazy load
const originalSwitch = switchPage;
window.switchPage = function(pageId) {
  originalSwitch(pageId);
  const headings = {
    dashboard: 'My Dashboard', tree: 'My Network', income: 'Income History',
    withdraw: 'Cash Withdrawal', 'add-member': 'Add Member', 'add-fund': 'Add Funds', settings: 'Settings'
  };
  document.getElementById('page-heading').textContent = headings[pageId] || 'Dashboard';

  if (pageId === 'dashboard') loadDashboard();
  if (pageId === 'tree') renderUserTree();
  if (pageId === 'income') loadIncome();
  if (pageId === 'withdraw') prepareWithdrawalPage();
  if (pageId === 'add-member') { renderAddMemberSlots(); generateAmPassword(); }

  const sidebar = document.getElementById('sidebar');
  const backdrop = document.getElementById('sidebar-backdrop');
  if (sidebar) sidebar.classList.remove('open');
  if (backdrop) backdrop.classList.remove('show');
};


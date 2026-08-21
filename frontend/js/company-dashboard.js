// company-dashboard.js v2 — PV system, ranks, KYC, SMI
requireAuth('admin');

const user = getUser();
let treeRenderer = null;

document.addEventListener('DOMContentLoaded', () => {
  const name = user?.name || 'Admin';
  document.getElementById('admin-name').textContent = name;
  document.getElementById('admin-avatar').textContent = name[0];
  document.getElementById('page-sub').textContent = `Welcome back, ${name}`;
  loadDashboard();
  loadDeposits();
});

// ── DASHBOARD ────────────────────────────────────────────────────────────────
async function loadDashboard() {
  try {
    const [stats, deposits, txns] = await Promise.all([
      apiCall('GET', '/admin/dashboard'),
      apiCall('GET', '/admin/deposits'),
      apiCall('GET', '/admin/transactions')
    ]);
    renderStats(stats);
    renderPendingWidget(deposits.filter(d => d.status === 'pending').slice(0, 5));
    if (typeof loadDashboardWithdrawalsWidget === 'function') {
      loadDashboardWithdrawalsWidget();
    }

    const pc = deposits.filter(d => d.status === 'pending').length;
    const badge = document.getElementById('pending-badge');
    if (badge) { badge.textContent = pc; badge.style.display = pc > 0 ? 'inline-block' : 'none'; }

    const pwc = parseInt(stats.pending_withdrawals || 0);
    const wbadge = document.getElementById('pending-withdrawals-badge');
    if (wbadge) { wbadge.textContent = pwc; wbadge.style.display = pwc > 0 ? 'inline-block' : 'none'; }
  } catch (err) {
    showToast('Dashboard load failed: ' + err.message, 'error');
  }
}

function renderStats(s) {
  const megaBal = parseFloat(s.mega_account_balance || 0);
  const companyEarned = parseFloat(s.company_earned_balance || 0);
  const userLiabilities = parseFloat(s.user_liabilities_balance || 0);
  const pendingWith = parseFloat(s.pending_withdrawal_amount || 0);

  document.getElementById('stats-grid').innerHTML = `
    <div class="stat-card green" style="grid-column: span 2; background: linear-gradient(135deg, rgba(16,185,129,0.15), rgba(5,150,105,0.25)); border:2px solid var(--accent-gold)">
      <span class="stat-icon" style="font-size:32px">🏦</span>
      <div class="stat-value green" style="font-size:28px">${formatRupee(megaBal)}</div>
      <div class="stat-label" style="font-weight:700;color:var(--accent-gold);font-size:13px">Mega Account (Company Master Ledger Balance)</div>
      <div style="font-size:11px;color:var(--text-muted);margin-top:4px">Superset of all money ever collected in the company treasury.</div>
    </div>
    <div class="stat-card gold"><span class="stat-icon">💼</span>
      <div class="stat-value gold">${formatRupee(companyEarned)}</div>
      <div class="stat-label">Company Earned Account (Retained Profit)</div>
      <div style="font-size:10px;color:var(--text-muted);margin-top:2px">Non-withdrawable profit from company-placed tree IDs + TDS/NWI</div></div>
    <div class="stat-card red"><span class="stat-icon">👤</span>
      <div class="stat-value red">${formatRupee(userLiabilities)}</div>
      <div class="stat-label">User Liabilities (Withdrawable Owed)</div>
      <div style="font-size:10px;color:var(--text-muted);margin-top:2px">Total withdrawable wallet balance of real Sales Associates</div></div>
    <div class="stat-card blue"><span class="stat-icon">💰</span>
      <div class="stat-value blue">${formatRupee(s.total_funds_collected)}</div>
      <div class="stat-label">Total Deposits Collected</div></div>
    <div class="stat-card purple" style="cursor:pointer" onclick="switchPage('withdrawals')"><span class="stat-icon">🏦</span>
      <div class="stat-value purple">${formatRupee(s.total_withdrawn_paid || 0)}</div>
      <div class="stat-label">Total Cash Paid Out (Withdrawals)</div></div>
    <div class="stat-card gold" style="cursor:pointer" onclick="switchPage('withdrawals')" title="Pending Withdrawals"><span class="stat-icon">⏳</span>
      <div class="stat-value gold">${s.pending_withdrawals || 0} (${formatRupee(pendingWith)})</div>
      <div class="stat-label">Pending Withdrawal Requests</div></div>
    <div class="stat-card green" style="cursor:pointer" onclick="switchPage('members');setMemberFilter('active')"><span class="stat-icon">🟢</span>
      <div class="stat-value green">${s.active_members}</div>
      <div class="stat-label">Active Members</div></div>
    <div class="stat-card red" style="cursor:pointer" onclick="switchPage('members');setMemberFilter('inactive')"><span class="stat-icon">🔴</span>
      <div class="stat-value red">${s.inactive_members}</div>
      <div class="stat-label">Inactive Members</div></div>
    <div class="stat-card green" style="cursor:pointer" onclick="switchPage('members');setMemberFilter('all')"><span class="stat-icon">👥</span>
      <div class="stat-value green">${s.total_members}</div>
      <div class="stat-label">Total Members</div></div>`;
}

function renderPendingWidget(deps) {
  const el = document.getElementById('dash-pending-deposits');
  if (!deps.length) { el.innerHTML = '<div class="empty-state"><div class="icon">✅</div><p>No pending approvals</p></div>'; return; }
  el.innerHTML = `<div class="table-wrapper"><table>
    <thead><tr><th>ID</th><th>Member</th><th>Amount</th><th>UTR</th><th>Action</th></tr></thead>
    <tbody>${deps.map(d => `<tr>
      <td><span class="badge badge-purple" style="font-family:monospace;cursor:pointer" onclick="showMemberDetails('${d.user_member_id}')" title="Click for member details">${d.user_member_id || '—'}</span></td>
      <td><div style="font-weight:600;cursor:pointer" onclick="showMemberDetails('${d.user_member_id}')" title="Click for member details">${d.user_name}</div></td>
      <td style="color:var(--gold);font-weight:700">${formatRupee(d.amount)}</td>
      <td style="font-family:monospace;font-size:11px">${d.utr_number}</td>
      <td><button class="btn btn-green btn-sm" onclick="approveDeposit(${d.id})">Approve</button></td>
    </tr>`).join('')}</tbody></table></div>`;
}

function renderTxnWidget(txns) {
  const el = document.getElementById('dash-recent-txns');
  if (!txns.length) { el.innerHTML = '<div class="empty-state"><div class="icon">📭</div><p>No transactions</p></div>'; return; }
  el.innerHTML = `<div class="table-wrapper"><table>
    <thead><tr><th>Member</th><th>Type</th><th>Amount</th><th>Status</th></tr></thead>
    <tbody>${txns.map(t => `<tr>
      <td style="font-weight:600;cursor:pointer" onclick="showMemberDetails('${t.user_member_id}')" title="Click for member details">${t.user_name}</td>
      <td><span class="badge ${typeClass(t.income_type)}">${t.income_label || t.income_type}</span></td>
      <td style="color:var(--gold);font-weight:700">${formatRupee(t.amount)}</td>
      <td><span class="badge ${t.status === 'credited' ? 'badge-green' : 'badge-red'}">${t.status}</span></td>
    </tr>`).join('')}</tbody></table></div>`;
}

function typeClass(t) {
  return { pair_income: 'badge-green', referral_income: 'badge-purple', smi_family_bonus: 'badge-gold', deposit: 'badge-blue', non_working_income: 'badge-blue' }[t] || 'badge-gray';
}

// ── TREE ─────────────────────────────────────────────────────────────────────
async function renderAdminTree() {
  try {
    const tree = await apiCall('GET', '/admin/tree');
    if (!treeRenderer) {
      treeRenderer = new BinaryTreeRenderer('tree-svg', {
        nodeWidth: 155, nodeHeight: 66, levelGap: 95, siblingGap: 24,
        onNodeClick: showNodeDetail
      });
    }
    treeRenderer.render(tree);
  } catch (err) { showToast('Tree load failed', 'error'); }
}

let selectedNodeData = null;
function showNodeDetail(node) {
  selectedNodeData = node;
  const prog = Math.min((parseFloat(node.total_deposited) / 12500) * 100, 100);
  document.getElementById('node-detail-title').textContent = node.name;
  document.getElementById('node-detail-body').innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:16px">
      <span class="status-dot ${node.is_active ? 'green' : 'red'}"></span>
      <span style="font-weight:700">${node.name}</span>
      <span class="badge badge-purple" style="font-size:10px">${node.rank_short || node.current_rank || 'SA'}</span>
      ${node.milestone_triggered ? '<span class="badge badge-gold">🏆 SMI Hit</span>' : ''}
      <span class="badge ${node.kyc_status === 'approved' ? 'badge-green' : 'badge-red'}" style="font-size:10px">KYC: ${node.kyc_status}</span>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:16px">
      <div class="income-item"><div class="income-amount" style="color:var(--gold)">${formatRupee(node.wallet_balance)}</div><div class="income-label">Wallet</div></div>
      <div class="income-item"><div class="income-amount" style="color:var(--red-light)">${formatRupee(node.pending_balance)}</div><div class="income-label">Pending</div></div>
      <div class="income-item"><div class="income-amount" style="color:var(--green-light)">${node.total_pairs || 0}</div><div class="income-label">Total Pairs</div></div>
      <div class="income-item"><div class="income-amount" style="color:var(--blue-light)">${node.left_count || 0} <span style="font-size:10px;opacity:0.8">(${parseFloat(node.left_pv || 0).toFixed(1)}L)</span></div><div class="income-label">Left Count (PV)</div></div>
      <div class="income-item"><div class="income-amount" style="color:var(--gold)">${node.right_count || 0} <span style="font-size:10px;opacity:0.8">(${parseFloat(node.right_pv || 0).toFixed(1)}R)</span></div><div class="income-label">Right Count (PV)</div></div>
      <div class="income-item"><div class="income-amount" style="color:var(--purple-light)">${node.total_downline || ((node.left_count || 0) + (node.right_count || 0))}</div><div class="income-label">Total Downline</div></div>
    </div>
    <div style="margin-bottom:12px">
      <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--text-secondary);margin-bottom:4px">
        <span>Activation</span><span>${formatRupee(node.total_deposited)} / ₹12,500</span>
      </div>
      <div class="activation-bar"><div class="activation-fill" style="width:${prog}%"></div></div>
    </div>
    <div style="font-size:12px;color:var(--text-secondary)">
      <div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--border)">
        <span>UTR Number</span><span style="color:var(--text-primary);font-family:monospace">${node.utr_number || '—'}</span>
      </div>
      <div style="display:flex;justify-content:space-between;padding:5px 0">
        <span>Position</span><span style="color:var(--text-primary)">${node.position || 'ROOT'}</span>
      </div>
    </div>
    ${node.kyc_status === 'pending' && node.role !== 'admin' ? `
      <div style="margin-top:12px;display:flex;gap:8px">
        <button class="btn btn-green btn-sm" onclick="approveKYC(${node.id})">✅ Approve KYC</button>
        <button class="btn btn-red btn-sm" onclick="rejectKYC(${node.id})">❌ Reject KYC</button>
      </div>` : ''}
    <div style="margin-top:12px">
      <button class="btn btn-ghost btn-sm" style="color:var(--purple-light);width:100%" onclick="closeModal('node-detail-modal');showMemberDetails('${node.member_id}')">📄 View Full Details & Sponsor Info</button>
    </div>`;

  const leftFree  = !node.left_child_id;
  const rightFree = !node.right_child_id;
  document.getElementById('node-add-left-btn').disabled  = false;
  document.getElementById('node-add-right-btn').disabled = false;
  document.getElementById('node-add-left-btn').textContent  = leftFree ? '+ Left Slot' : '+ Left Leg (Spillover)';
  document.getElementById('node-add-right-btn').textContent = rightFree ? '+ Right Slot' : '+ Right Leg (Spillover)';
  document.getElementById('node-detail-modal').classList.add('show');
}

async function approveKYC(userId) {
  try {
    await apiCall('POST', `/admin/kyc/${userId}/approve`);
    showToast('KYC approved!', 'success');
    renderAdminTree();
    closeModal('node-detail-modal');
  } catch (err) { showToast(err.message, 'error'); }
}

async function rejectKYC(userId) {
  try {
    await apiCall('POST', `/admin/kyc/${userId}/reject`);
    showToast('KYC rejected', 'info');
    closeModal('node-detail-modal');
  } catch (err) { showToast(err.message, 'error'); }
}

function addToNode(pos) {
  closeModal('node-detail-modal');
  openAddUserModal(selectedNodeData?.member_id || 'BAP0000', pos);
}

// ── MEMBERS ──────────────────────────────────────────────────────────────────
let allMembersCache = [];
let currentMemberFilter = 'all';

async function loadMembers() {
  try {
    allMembersCache = await apiCall('GET', '/admin/users');
    filterMembersTable();
  } catch (err) { showToast('Members load failed', 'error'); }
}

function setMemberFilter(filter) {
  currentMemberFilter = filter;
  document.querySelectorAll('[id^="filter-btn-"]').forEach(btn => {
    btn.classList.remove('btn-gold');
    btn.classList.add('btn-ghost');
  });
  const activeBtn = document.getElementById(`filter-btn-${filter}`);
  if (activeBtn) {
    activeBtn.classList.remove('btn-ghost');
    activeBtn.classList.add('btn-gold');
  }
  filterMembersTable();
}

// ── MEMBER DETAILS MODAL ──────────────────────────────────────────────────────
async function showMemberDetails(memberId) {
  if (!memberId || memberId === '—') return;
  try {
    // Always fetch from API to get left_count/right_count from server
    const member = await apiCall('GET', `/admin/members/${memberId}`);

    let chainStr = '—';
    try {
      const chainRes = await apiCall('GET', `/admin/chain/${memberId}`);
      if (chainRes && chainRes.display) chainStr = chainRes.display;
    } catch (e) {}

    document.getElementById('member-detail-title').textContent = `${member.name} (${member.member_id})`;
    document.getElementById('member-detail-body').innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;background:rgba(255,255,255,0.03);padding:12px 16px;border-radius:12px;border:1px solid var(--border)">
        <div style="display:flex;align-items:center;gap:12px">
          <div style="width:44px;height:44px;border-radius:50%;background:linear-gradient(135deg,var(--purple-light),#4f46e5);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:18px;color:#fff">
            ${(member.name || 'M')[0].toUpperCase()}
          </div>
          <div>
            <div style="font-weight:700;font-size:16px;color:var(--text-primary)">${member.name}</div>
            <div style="font-size:12px;color:var(--text-muted)">Member ID: <span style="font-family:monospace;color:var(--gold);font-weight:700">${member.member_id}</span></div>
          </div>
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">
          <span class="badge ${member.source_type === 'COMPANY_PLACED' ? 'badge-gold' : 'badge-purple'}">${member.source_type === 'COMPANY_PLACED' ? '🏢 Company Placed' : '👤 Real User'}</span>
          <span class="badge ${member.is_active ? 'badge-green' : 'badge-red'}">${member.is_active ? '🟢 Active' : '🔴 Inactive'}</span>
          <span class="badge badge-purple">${member.rank_short || member.rank_name || member.current_rank || 'SA'}</span>
          <span class="badge ${member.kyc_status === 'approved' ? 'badge-green' : member.kyc_status === 'rejected' ? 'badge-red' : 'badge-gold'}">KYC: ${member.kyc_status || 'pending'}</span>
        </div>
      </div>

      <!-- Who Added This ID (Sponsor) & Placement -->
      <div style="background:rgba(139,92,246,0.08);border:1px solid rgba(139,92,246,0.3);border-radius:12px;padding:16px;margin-bottom:16px">
        <div style="font-weight:700;color:var(--purple-light);font-size:13px;margin-bottom:10px;display:flex;align-items:center;gap:6px">
          <span>🤝</span> Who Added This Member (Sponsor & Tree Placement)
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;font-size:12px">
          <div style="background:rgba(0,0,0,0.25);padding:12px;border-radius:8px">
            <div style="color:var(--text-muted);font-size:11px;margin-bottom:4px">Added By / Sponsor</div>
            <div style="font-weight:700;color:var(--gold);font-size:14px">${member.sponsor_name || 'Company / Direct'}</div>
            <div style="font-family:monospace;font-size:11px;color:var(--text-secondary);margin-top:2px">Sponsor ID: <strong>${member.sponsor_member_id || 'BAP0000'}</strong></div>
          </div>
          <div style="background:rgba(0,0,0,0.25);padding:12px;border-radius:8px">
            <div style="color:var(--text-muted);font-size:11px;margin-bottom:4px">Tree Placement Node (Parent)</div>
            <div style="font-weight:700;color:var(--green-light);font-size:14px">${member.parent_name || 'Company (Root)'}</div>
            <div style="font-family:monospace;font-size:11px;color:var(--text-secondary);margin-top:2px">Parent ID: <strong>${member.parent_member_id || 'BAP0000'}</strong> (${(member.position || 'ROOT').toUpperCase()})</div>
          </div>
        </div>
        <div style="margin-top:12px;font-size:12px;color:var(--text-secondary);background:rgba(0,0,0,0.15);padding:8px 12px;border-radius:6px">
          🔗 <strong>Full Upline Chain:</strong> <span style="font-family:monospace;color:var(--gold);word-break:break-all">${chainStr}</span>
        </div>
      </div>

      <!-- Downline Tree Counts -->
      <div style="background:rgba(16,185,129,0.06);border:1px solid rgba(16,185,129,0.25);border-radius:12px;padding:16px;margin-bottom:16px">
        <div style="font-weight:700;color:var(--green-light);font-size:13px;margin-bottom:12px;display:flex;align-items:center;gap:6px">
          <span>🌿</span> Downline Network Size
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px">
          <div style="background:rgba(0,0,0,0.25);border-radius:10px;padding:14px;text-align:center;border-left:3px solid var(--blue-light)">
            <div style="font-size:26px;font-weight:800;color:var(--blue-light);line-height:1">${parseInt(member.left_count)||0}</div>
            <div style="font-size:11px;color:var(--text-muted);margin-top:4px">◀ Left Leg</div>
          </div>
          <div style="background:rgba(0,0,0,0.25);border-radius:10px;padding:14px;text-align:center;border-left:3px solid var(--gold)">
            <div style="font-size:26px;font-weight:800;color:var(--gold);line-height:1">${parseInt(member.right_count)||0}</div>
            <div style="font-size:11px;color:var(--text-muted);margin-top:4px">▶ Right Leg</div>
          </div>
          <div style="background:rgba(0,0,0,0.25);border-radius:10px;padding:14px;text-align:center;border-left:3px solid var(--purple-light)">
            <div style="font-size:26px;font-weight:800;color:var(--purple-light);line-height:1">${parseInt(member.total_downline)||0}</div>
            <div style="font-size:11px;color:var(--text-muted);margin-top:4px">🌐 Total Network</div>
          </div>
        </div>
      </div>

      <!-- Financial & PV Details -->
      <div style="display:grid;grid-template-columns:repeat(3, 1fr);gap:10px;margin-bottom:16px">
        <div class="income-item"><div class="income-amount" style="color:var(--gold)">${formatRupee(member.total_deposited)}</div><div class="income-label">Total Deposited</div></div>
        <div class="income-item"><div class="income-amount" style="color:var(--green-light)">${formatRupee(member.wallet_balance)}</div><div class="income-label">Wallet Balance</div></div>
        <div class="income-item"><div class="income-amount" style="color:var(--red-light)">${formatRupee(member.pending_balance)}</div><div class="income-label">Pending Balance</div></div>
        <div class="income-item"><div class="income-amount" style="color:var(--blue-light)">${parseFloat(member.left_pv||0).toFixed(1)}L</div><div class="income-label">Left PV</div></div>
        <div class="income-item"><div class="income-amount" style="color:var(--gold)">${parseFloat(member.right_pv||0).toFixed(1)}R</div><div class="income-label">Right PV</div></div>
        <div class="income-item"><div class="income-amount" style="color:var(--purple-light)">${member.total_pairs || 0} ${member.milestone_triggered ? '🏆' : ''}</div><div class="income-label">Pairs Matched</div></div>
      </div>

      <!-- Personal & Account Details -->
      <div style="background:rgba(255,255,255,0.02);border:1px solid var(--border);border-radius:10px;padding:14px;font-size:12px;color:var(--text-secondary)">
        <div style="font-weight:600;color:var(--text-primary);margin-bottom:10px">📋 Personal & Account Information</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
          <div>📧 <strong>Email:</strong> ${member.email || '—'}</div>
          <div>📞 <strong>Phone:</strong> ${member.phone || '—'}</div>
          <div>💳 <strong>UTR Number:</strong> <span style="font-family:monospace;color:var(--gold)">${member.utr_number || '—'}</span></div>
          <div>📅 <strong>Joined Date:</strong> ${formatDate(member.created_at)}</div>
          ${member.address ? `<div style="grid-column:span 2">📍 <strong>Address:</strong> ${member.address}</div>` : ''}
          ${member.qualification ? `<div>🎓 <strong>Qualification:</strong> ${member.qualification}</div>` : ''}
          ${member.purpose ? `<div>🎯 <strong>Purpose:</strong> ${member.purpose}</div>` : ''}
        </div>
      </div>

      <!-- Login Password (Admin View) -->
      <div style="margin-top:12px;background:rgba(245,158,11,0.07);border:1px solid rgba(245,158,11,0.3);border-radius:10px;padding:14px">
        <div style="font-weight:600;color:var(--gold);margin-bottom:10px;font-size:12px;display:flex;align-items:center;gap:6px">
          🔑 Login Password <span style="font-weight:400;color:var(--text-muted);font-size:10px">(Admin Only — Not visible to member)</span>
        </div>
        ${member.plain_password ? `
          <div style="display:flex;align-items:center;gap:10px">
            <input type="password" id="pwd-reveal-${member.member_id}" value="${member.plain_password}"
              readonly style="flex:1;font-family:monospace;font-size:15px;font-weight:700;background:rgba(245,158,11,0.1);
              border:1px solid rgba(245,158,11,0.3);color:var(--gold);border-radius:8px;padding:8px 12px;letter-spacing:2px;outline:none">
            <button onclick="
              const inp = document.getElementById('pwd-reveal-${member.member_id}');
              inp.type = inp.type === 'password' ? 'text' : 'password';
              this.textContent = inp.type === 'password' ? '👁' : '🙈';
            " style="background:rgba(245,158,11,0.15);border:1px solid rgba(245,158,11,0.3);
              color:var(--gold);border-radius:8px;padding:8px 12px;cursor:pointer;font-size:16px" title="Show/Hide password">👁</button>
            <button onclick="navigator.clipboard.writeText('${member.plain_password}').then(()=>showToast('Password copied!','success'))"
              style="background:rgba(245,158,11,0.15);border:1px solid rgba(245,158,11,0.3);
              color:var(--gold);border-radius:8px;padding:8px 12px;cursor:pointer;font-size:13px" title="Copy password">📋 Copy</button>
          </div>
        ` : `
          <div style="font-size:12px;color:var(--text-muted);font-style:italic">
            No password on record (member registered before this feature or changed their password).
            Use <strong style="color:var(--gold)">Reset Password</strong> to generate a new one.
          </div>
        `}
      </div>
    `;

    document.getElementById('member-detail-footer').innerHTML = `
      <button class="btn btn-ghost" onclick="closeModal('member-detail-modal')">Close</button>
      <button class="btn btn-ghost btn-sm" style="color:var(--gold)" onclick="closeModal('member-detail-modal');resetMemberPassword('${member.member_id}', '${(member.name||'').replace(/'/g, "\\'")}')">🔑 Reset Password</button>
    `;

    document.getElementById('member-detail-modal').classList.add('show');
  } catch (err) {
    showToast('Failed to load member details: ' + err.message, 'error');
  }
}

function filterMembersTable() {
  const query = (document.getElementById('member-search-input')?.value || '').toLowerCase().trim();
  
  let filtered = allMembersCache.filter(m => {
    // Status filter
    if (currentMemberFilter === 'active' && !m.is_active) return false;
    if (currentMemberFilter === 'inactive' && m.is_active) return false;
    if (currentMemberFilter === 'company' && m.source_type !== 'COMPANY_PLACED') return false;
    if (currentMemberFilter === 'kyc' && m.kyc_status !== 'pending') return false;

    // Search query match (Member ID, Name, Email, UTR)
    if (query) {
      const matchId    = (m.member_id || '').toLowerCase().includes(query);
      const matchName  = (m.name || '').toLowerCase().includes(query);
      const matchEmail = (m.email || '').toLowerCase().includes(query);
      const matchUtr   = (m.utr_number || '').toLowerCase().includes(query);
      if (!matchId && !matchName && !matchEmail && !matchUtr) return false;
    }
    return true;
  });

  const subLabel = document.getElementById('member-count-sub');
  if (subLabel) subLabel.textContent = `Showing ${filtered.length} of ${allMembersCache.length} members`;

  const tbody = document.getElementById('members-table-body');
  if (!tbody) return;

  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan="11" style="text-align:center;padding:24px;color:var(--text-muted)">No members match the search criteria.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map(m => `<tr>
    <td>
      <span class="badge badge-purple" style="font-family:monospace;font-weight:700;cursor:pointer" onclick="showMemberDetails('${m.member_id}')" title="Click to view details & sponsor info">
        ${m.member_id}
      </span>
    </td>
    <td>
      <span class="badge ${m.source_type === 'COMPANY_PLACED' ? 'badge-gold' : 'badge-blue'}" style="font-size:10px">
        ${m.source_type === 'COMPANY_PLACED' ? '🏢 COMPANY' : '👤 REAL'}
      </span>
    </td>
    <td>
      <div style="font-weight:600;cursor:pointer;color:var(--text-primary)" onclick="showMemberDetails('${m.member_id}')" title="Click to view details & sponsor info">
        ${m.name}
      </div>
      <div style="font-size:11px;color:var(--text-muted)">${m.email}</div>
    </td>
    <td style="font-family:monospace;font-size:11px">${m.utr_number || '—'}</td>
    <td><span class="badge badge-purple" style="font-size:10px">${m.rank_short || m.current_rank}</span></td>
    <td><div style="font-weight:700;color:var(--gold)">${formatRupee(m.total_deposited)}</div></td>
    <td>
      <span style="color:var(--blue-light);font-weight:600">${parseFloat(m.left_pv||0).toFixed(1)}L</span> /
      <span style="color:var(--gold);font-weight:600">${parseFloat(m.right_pv||0).toFixed(1)}R</span>
    </td>
    <td style="font-weight:700;text-align:center">${m.total_pairs} ${m.milestone_triggered ? '🏆' : ''}</td>
    <td><span class="status-dot ${m.is_active ? 'green' : 'red'}"></span>
        <span class="badge ${m.is_active ? 'badge-green' : 'badge-red'}">${m.is_active ? 'Active' : 'Inactive'}</span></td>
    <td><span class="badge ${m.kyc_status === 'approved' ? 'badge-green' : m.kyc_status === 'rejected' ? 'badge-red' : 'badge-gold'}">${m.kyc_status}</span></td>
    <td style="font-size:11px;color:var(--text-muted)">${formatDate(m.created_at)}</td>
    <td style="display:flex;gap:4px">
      <button class="btn btn-ghost btn-sm" style="color:var(--gold)" onclick="resetMemberPassword('${m.member_id}', '${m.name.replace(/'/g, "\\'")}')" title="Reset Member Password">🔑 Pwd</button>
      <button class="btn btn-ghost btn-sm" style="color:var(--purple-light)" onclick="toggleSourceType('${m.member_id}', '${m.source_type}')" title="Convert Real <-> Company ID">🔄 Switch</button>
    </td>
  </tr>`).join('');
}

async function resetMemberPassword(memberId, name) {
  if (!confirm(`Are you sure you want to reset password for ${name} (${memberId})?`)) return;
  try {
    const res = await apiCall('POST', `/admin/members/${memberId}/reset-password`);
    showToast(`Password reset for ${name}!`, 'success');
    
    // Display temp password in modal alert
    const parentEl = document.getElementById('add-user-alert');
    if (parentEl) {
      parentEl.innerHTML = `
        <div style="margin:16px 0;background:rgba(245,158,11,0.08);border:1px solid rgba(245,158,11,0.3);border-radius:12px;padding:16px">
          <div style="font-weight:700;color:var(--gold);margin-bottom:10px">🔑 Password Reset Successful</div>
          <div style="display:grid;grid-template-columns:120px 1fr;gap:6px;font-size:13px">
            <span style="color:var(--text-muted)">Member ID:</span><span style="font-family:monospace;font-weight:700;color:var(--gold)">${res.member_id}</span>
            <span style="color:var(--text-muted)">Name:</span><span style="font-weight:600">${res.name}</span>
            <span style="color:var(--text-muted)">New Temp Pwd:</span>
            <span style="font-family:monospace;font-weight:700;font-size:16px;background:rgba(245,158,11,0.18);padding:3px 10px;border-radius:6px;color:var(--gold)">${res.temp_password}</span>
          </div>
          <div style="margin-top:10px;font-size:11px;color:var(--text-muted)">⚠️ Provide this temporary password to the member. They must change it upon their next login.</div>
        </div>`;
      document.getElementById('add-user-modal')?.classList.add('show');
      const btn = document.getElementById('add-user-btn');
      if (btn) {
        btn.textContent = 'Close';
        btn.onclick = () => { closeModal('add-user-modal'); btn.textContent = 'Add Member'; btn.onclick = submitAddUser; };
      }
    } else {
      alert(`New Temp Password for ${res.name} (${res.member_id}): ${res.temp_password}`);
    }
  } catch (err) {
    showToast(err.message || 'Password reset failed', 'error');
  }
}

// ── DEPOSITS ─────────────────────────────────────────────────────────────────
async function loadDeposits() {
  try {
    const deposits = await apiCall('GET', '/admin/deposits');
    const pc = deposits.filter(d => d.status === 'pending').length;
    const badge = document.getElementById('pending-badge');
    badge.textContent = pc; badge.style.display = pc > 0 ? 'inline-block' : 'none';

    document.getElementById('deposits-table-body').innerHTML = deposits.map(d => {
      return `<tr>
        <td>
          <span class="badge badge-purple" style="font-family:monospace;font-weight:700;cursor:pointer" onclick="showMemberDetails('${d.user_member_id}')" title="Click for member details">
            ${d.user_member_id || '—'}
          </span>
        </td>
        <td>
          <div style="font-weight:600;cursor:pointer" onclick="showMemberDetails('${d.user_member_id}')" title="Click for member details">${d.user_name}</div>
          <div style="font-size:11px;color:var(--text-muted)">${d.user_email}</div>
        </td>
        <td style="font-family:monospace;font-size:12px;font-weight:600;color:var(--gold)">${d.utr_number}</td>
        <td style="font-weight:700;color:var(--gold)">${formatRupee(d.amount)}</td>
        <td style="font-size:11px;color:var(--text-secondary)">${formatDateTime(d.created_at)}</td>
        <td><span class="badge ${d.status === 'approved' ? 'badge-green' : d.status === 'rejected' ? 'badge-red' : 'badge-gold'}">${d.status.toUpperCase()}</span></td>
        <td>${d.status === 'pending' ? `
          <button class="btn btn-green btn-sm" onclick="approveDeposit(${d.id})">✅ Approve</button>
          <button class="btn btn-red btn-sm" onclick="rejectDeposit(${d.id})" style="margin-left:4px">❌ Reject</button>` :
          '<span style="font-size:11px;color:var(--text-muted)">Done</span>'}</td>
      </tr>`;
    }).join('');
  } catch (err) { showToast('Deposits load failed', 'error'); }
}

async function approveDeposit(id) {
  if (!confirm('Approve this deposit?')) return;
  try {
    const r = await apiCall('POST', `/admin/deposits/${id}/approve`);
    showToast(r.message, 'success');
    loadDeposits(); loadDashboard();
  } catch (err) { showToast('Error: ' + err.message, 'error'); }
}

async function rejectDeposit(id) {
  if (!confirm('Reject?')) return;
  try {
    await apiCall('POST', `/admin/deposits/${id}/reject`, { notes: 'Rejected by admin' });
    showToast('Deposit rejected', 'info');
    loadDeposits();
  } catch (err) { showToast(err.message, 'error'); }
}

// ── TRANSACTIONS ─────────────────────────────────────────────────────────────
async function loadTransactions() {
  try {
    const txns = await apiCall('GET', '/admin/transactions');
    document.getElementById('txns-table-body').innerHTML = txns.map(t => `<tr>
      <td style="font-size:11px;color:var(--text-secondary);white-space:nowrap">${formatDateTime(t.created_at)}</td>
      <td style="font-weight:600">${t.user_name}</td>
      <td><span class="badge ${typeClass(t.income_type)}">${t.income_label || t.income_type}</span></td>
      <td style="font-weight:700;color:var(--gold)">${formatRupee(t.amount)}</td>
      <td><span class="badge ${t.status === 'credited' ? 'badge-green' : 'badge-gold'}">${t.status.toUpperCase()}</span></td>
      <td style="font-size:11px;color:var(--text-secondary)">${t.description || '—'}</td>
      <td>${t.status === 'pending' ? `<button class="btn btn-green btn-sm" onclick="approveTransaction(${t.id})">Approve</button>` : '<span style="font-size:11px;color:var(--text-muted)">—</span>'}</td>
    </tr>`).join('');
  } catch (err) { showToast('Transactions load failed', 'error'); }
}

async function approveTransaction(id) {
  if (!confirm('Approve and credit this transaction to member wallet?')) return;
  try {
    const r = await apiCall('POST', `/admin/transactions/${id}/approve`);
    showToast(r.message, 'success');
    loadTransactions(); loadDashboard();
  } catch (err) { showToast('Error: ' + err.message, 'error'); }
}

// ── ADD MEMBER MODAL ──────────────────────────────────────────────────────────
function generatePassword() {
  // 10-char password: letters + digits, no ambiguous chars
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789@#!';
  let pwd = '';
  for (let i = 0; i < 10; i++) pwd += chars[Math.floor(Math.random() * chars.length)];
  document.getElementById('new-password').value = pwd;
}

function openAddUserModal(parentId = 'BAP0000', pos = '') {
  document.getElementById('add-user-alert').innerHTML = '';
  document.getElementById('add-user-form').reset();
  document.getElementById('new-parent').value = parentId || 'BAP0000';
  if (pos) document.getElementById('new-position').value = pos;
  generatePassword(); // auto-generate fresh password each time
  document.getElementById('add-user-modal').classList.add('show');
}

async function submitAddUser() {
  const alertEl = document.getElementById('add-user-alert');
  const btn = document.getElementById('add-user-btn');
  btn.disabled = true; alertEl.innerHTML = '';

  try {
    const tempPassword = document.getElementById('new-password').value;
    const isCompanyPlaced = document.getElementById('new-is-company-placed')?.checked;
    const res = await apiCall('POST', '/admin/add-user', {
      name:               document.getElementById('new-name').value,
      email:              document.getElementById('new-email').value,
      phone:              document.getElementById('new-phone').value,
      parent_member_id:   document.getElementById('new-parent').value,
      position:           document.getElementById('new-position').value,
      sponsor_member_id:  document.getElementById('new-sponsor')?.value || '',
      password:           tempPassword,
      source_type:        isCompanyPlaced ? 'COMPANY_PLACED' : 'REAL_USER'
    });
    showToast(`${res.user.name} added as ${res.user.member_id}!`, 'success');
    closeModal('add-user-modal');
    // Show credential card with temp password so admin can share it
    const credHtml = `
      <div style="margin:16px 0;background:rgba(16,185,129,0.06);border:1px solid rgba(16,185,129,0.25);border-radius:12px;padding:16px">
        <div style="font-weight:700;color:var(--green-light);margin-bottom:10px">✅ Member Added Successfully</div>
        <div style="display:grid;grid-template-columns:120px 1fr;gap:6px;font-size:13px">
          <span style="color:var(--text-muted)">Member ID:</span><span style="font-family:monospace;font-weight:700;color:var(--gold)">${res.user.member_id}</span>
          <span style="color:var(--text-muted)">Name:</span><span style="font-weight:600">${res.user.name}</span>
          <span style="color:var(--text-muted)">Email:</span><span>${res.user.email}</span>
          <span style="color:var(--text-muted)">Temp Password:</span>
          <span style="font-family:monospace;font-weight:700;font-size:15px;background:rgba(245,158,11,0.12);padding:2px 8px;border-radius:6px;color:var(--gold)">${tempPassword}</span>
        </div>
        <div style="margin-top:10px;font-size:11px;color:var(--text-muted)">⚠️ Share this password with the member. They can change it from their dashboard settings. This will not be shown again.</div>
      </div>`;
    document.getElementById('add-user-alert').innerHTML = credHtml;
    document.getElementById('add-user-modal').classList.add('show'); // re-open to show credentials
    document.getElementById('add-user-btn').textContent = 'Close';
    document.getElementById('add-user-btn').onclick = () => { closeModal('add-user-modal'); document.getElementById('add-user-btn').textContent = 'Add Member'; document.getElementById('add-user-btn').onclick = submitAddUser; };
    loadDashboard(); loadMembers();
    if (document.getElementById('page-tree').classList.contains('active')) renderAdminTree();
  } catch (err) {
    alertEl.innerHTML = `<div class="alert alert-error">⚠️ ${err.message}</div>`;
  } finally { btn.disabled = false; }
}

function closeModal(id) { document.getElementById(id).classList.remove('show'); }

// ── DAILY JOB TRIGGER ─────────────────────────────────────────────────────────
async function runDailyJob() {
  if (!confirm('Run daily pair matching job now? (normally runs at midnight)')) return;
  try {
    const r = await apiCall('POST', '/admin/run-daily-job');
    showToast(r.message, 'success');
    loadDashboard();
  } catch (err) { showToast(err.message, 'error'); }
}

async function fixMilestones() {
  if (!confirm('Fix missing milestone bonuses for all eligible members?')) return;
  try {
    const r = await apiCall('POST', '/admin/fix-milestones');
    if (r.fixed && r.fixed.length) {
      showToast(`${r.message} Members: ${r.fixed.map(f => f.member_id).join(', ')}`, 'success');
    } else {
      showToast('No missing milestones found — all up to date!', 'info');
    }
    loadDashboard();
  } catch (err) { showToast(err.message, 'error'); }
}

// ── INQUIRIES ─────────────────────────────────────────────────────────────────
async function loadInquiries() {
  const tbody = document.getElementById('inquiries-table-body');
  tbody.innerHTML = '<tr><td colspan="6"><div class="loading"><div class="spinner"></div></div></td></tr>';
  try {
    const rows = await apiCall('GET', '/admin/contacts');
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--text-muted);padding:30px">No website inquiries received yet.</td></tr>';
      return;
    }
    tbody.innerHTML = rows.map(m => {
      const dateStr = formatDateTime(m.created_at);
      return `
        <tr style="${m.is_read ? '' : 'background:rgba(139,92,246,0.05);font-weight:600'}">
          <td style="white-space:nowrap">${dateStr}</td>
          <td>${escapeHtml(m.name)}</td>
          <td>
            ${m.email ? `<div>📧 ${escapeHtml(m.email)}</div>` : ''}
            ${m.phone ? `<div>📞 ${escapeHtml(m.phone)}</div>` : ''}
          </td>
          <td style="max-width:300px;word-break:break-word">${escapeHtml(m.message)}</td>
          <td>
            ${m.is_read 
              ? '<span class="badge badge-gray">Read</span>' 
              : '<span class="badge badge-purple">New</span>'}
          </td>
          <td style="display:flex;gap:6px">
            ${!m.is_read ? `<button class="btn btn-ghost btn-sm" onclick="markInquiryRead(${m.id})">Mark Read</button>` : ''}
            <button class="btn btn-red btn-sm" onclick="deleteInquiry(${m.id})">🗑️</button>
          </td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="6" style="color:var(--red-light)">⚠️ ${err.message}</td></tr>`;
  }
}

async function markInquiryRead(id) {
  try {
    await apiCall('POST', `/admin/contacts/${id}/read`);
    loadInquiries();
  } catch (err) { showToast(err.message, 'error'); }
}

async function deleteInquiry(id) {
  if (!confirm('Delete this inquiry?')) return;
  try {
    await apiCall('DELETE', `/admin/contacts/${id}`);
    showToast('Inquiry deleted', 'info');
    loadInquiries();
  } catch (err) { showToast(err.message, 'error'); }
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function toggleMobileSidebar() {
  const sidebar = document.getElementById('sidebar');
  const backdrop = document.getElementById('sidebar-backdrop');
  if (sidebar) sidebar.classList.toggle('open');
  if (backdrop) backdrop.classList.toggle('show');
}

// ── CONVERT MEMBER SOURCE TYPE (REAL_USER <-> COMPANY_PLACED) ────────────────
async function toggleSourceType(memberId, currentSourceType) {
  let reason = '';
  let confirmDemotion = false;

  if (currentSourceType === 'REAL_USER') {
    const text = prompt(
      `⚠️ WARNING: Converting Real Associate (${memberId}) to Company Placed will direct ALL future binary & referral earnings to Company Profit.\n\nPlease enter an administrative reason for this conversion:`
    );
    if (text === null) return; // User cancelled
    reason = text.trim();
    if (reason.length < 5) {
      alert('⚠️ Administrative reason is required (at least 5 characters). Conversion cancelled.');
      return;
    }
  } else {
    if (!confirm(`Assign Company Placed ID (${memberId}) to a Real Associate (KYC Onboarding)?`)) return;
    reason = 'Assigning to real distributor via admin';
  }

  try {
    let res = await apiCall('POST', `/admin/members/${memberId}/convert-source`, {
      reason,
      confirm_demotion: false
    });
    showToast(res.message, 'success');
    loadMembers(); loadDashboard();
  } catch (err) {
    if (err.requiresConfirmation) {
      if (confirm(`${err.message}\n\nDo you explicitly confirm demoting this member?`)) {
        try {
          const res2 = await apiCall('POST', `/admin/members/${memberId}/convert-source`, {
            reason,
            confirm_demotion: true
          });
          showToast(res2.message, 'success');
          loadMembers(); loadDashboard();
        } catch (err2) { showToast(err2.message, 'error'); }
      }
    } else {
      showToast(err.message, 'error');
    }
  }
}

// ── WITHDRAWALS MANAGEMENT ───────────────────────────────────────────────────
async function loadDashboardWithdrawalsWidget() {
  const el = document.getElementById('dash-pending-withdrawals');
  if (!el) return;
  try {
    const withdrawals = await apiCall('GET', '/admin/withdrawals');
    const pending = withdrawals.filter(w => w.status === 'pending').slice(0, 5);
    if (!pending.length) {
      el.innerHTML = '<div class="empty-state"><div class="icon">✅</div><p>No pending withdrawal requests</p></div>';
      return;
    }
    el.innerHTML = `<div class="table-wrapper"><table>
      <thead><tr><th>Member</th><th>Requested</th><th>Net Pay</th><th>Action</th></tr></thead>
      <tbody>${pending.map(w => `<tr>
        <td>
          <div style="font-weight:600">${w.user_name}</div>
          <div style="font-family:monospace;font-size:11px;color:var(--gold)">${w.user_member_id}</div>
        </td>
        <td style="color:var(--text-muted);font-weight:600">${formatRupee(w.requested_amount)}</td>
        <td style="color:var(--green-light);font-weight:700">${formatRupee(w.net_amount)}</td>
        <td><button class="btn btn-green btn-sm" onclick="approveWithdrawal(${w.id})">Approve Payout</button></td>
      </tr>`).join('')}</tbody></table></div>`;
  } catch (err) { el.innerHTML = `<div style="color:var(--red-light);padding:12px">⚠️ Failed to load pending withdrawals</div>`; }
}

async function loadWithdrawals() {
  const tbody = document.getElementById('withdrawals-table-body');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="10"><div class="loading"><div class="spinner"></div></div></td></tr>';
  try {
    const rows = await apiCall('GET', '/admin/withdrawals');
    const pc = rows.filter(r => r.status === 'pending').length;
    const wbadge = document.getElementById('pending-withdrawals-badge');
    if (wbadge) { wbadge.textContent = pc; wbadge.style.display = pc > 0 ? 'inline-block' : 'none'; }

    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="10" style="text-align:center;padding:30px;color:var(--text-muted)">No withdrawal requests found.</td></tr>';
      return;
    }

    tbody.innerHTML = rows.map(w => `
      <tr>
        <td style="font-family:monospace;font-weight:700">#${w.id}</td>
        <td>
          <div style="font-weight:600;cursor:pointer" onclick="showMemberDetails('${w.user_member_id}')">${w.user_name}</div>
          <div style="font-family:monospace;font-size:11px;color:var(--gold)">${w.user_member_id}</div>
        </td>
        <td style="font-weight:700;color:var(--text-primary)">${formatRupee(w.requested_amount)}</td>
        <td style="color:var(--red-light)">-${formatRupee(w.tds_amount)} <span style="font-size:10px">(5%)</span></td>
        <td style="color:var(--red-light)">-${formatRupee(w.nwi_amount)} <span style="font-size:10px">(10%)</span></td>
        <td style="font-weight:800;color:var(--green-light);font-size:15px">${formatRupee(w.net_amount)}</td>
        <td style="font-size:11px;color:var(--text-secondary)">
          <div><strong>Bank:</strong> ${w.bank_name || '—'}</div>
          <div><strong>Acc:</strong> <span style="font-family:monospace">${w.bank_account || '—'}</span></div>
          <div><strong>IFSC:</strong> <span style="font-family:monospace">${w.bank_ifsc || '—'}</span></div>
        </td>
        <td style="font-size:11px;color:var(--text-muted);white-space:nowrap">${formatDateTime(w.created_at)}</td>
        <td><span class="badge ${w.status === 'approved' ? 'badge-green' : w.status === 'rejected' ? 'badge-red' : 'badge-gold'}">${w.status.toUpperCase()}</span></td>
        <td>${w.status === 'pending' ? `
          <button class="btn btn-green btn-sm" onclick="approveWithdrawal(${w.id})">✅ Approve Payout</button>
          <button class="btn btn-red btn-sm" onclick="rejectWithdrawal(${w.id})" style="margin-left:4px">❌ Reject</button>` :
          `<span style="font-size:11px;color:var(--text-muted)">Done</span>`}</td>
      </tr>
    `).join('');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="10" style="color:var(--red-light)">⚠️ ${err.message}</td></tr>`;
  }
}

async function approveWithdrawal(id) {
  if (!confirm(`Approve withdrawal request #${id}? This will process the cash payout (5% TDS & 10% NWI retained by company) and deduct the gross amount from member wallet.`)) return;
  try {
    const res = await apiCall('POST', `/admin/withdrawals/${id}/approve`);
    showToast(res.message, 'success');
    loadWithdrawals(); loadDashboard();
  } catch (err) { showToast(err.message, 'error'); }
}

async function rejectWithdrawal(id) {
  const reason = prompt('Enter rejection reason (optional):', 'Rejected by admin');
  if (reason === null) return;
  try {
    await apiCall('POST', `/admin/withdrawals/${id}/reject`, { notes: reason });
    showToast('Withdrawal request rejected', 'info');
    loadWithdrawals(); loadDashboard();
  } catch (err) { showToast(err.message, 'error'); }
}

// ── MEGA LEDGER AUDIT TRAIL ───────────────────────────────────────────────────
async function loadMegaLedger() {
  const tbody = document.getElementById('megaledger-table-body');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="8"><div class="loading"><div class="spinner"></div></div></td></tr>';
  try {
    const rows = await apiCall('GET', '/admin/mega-ledger');
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:30px;color:var(--text-muted)">No entries in Mega Ledger yet.</td></tr>';
      return;
    }
    tbody.innerHTML = rows.map(m => `
      <tr>
        <td style="font-family:monospace;font-weight:700">#${m.id}</td>
        <td style="font-size:11px;color:var(--text-secondary);white-space:nowrap">${formatDateTime(m.created_at)}</td>
        <td><span class="badge ${m.transaction_type === 'INFLOW' ? 'badge-green' : m.transaction_type === 'OUTFLOW' ? 'badge-red' : 'badge-gold'}">${m.transaction_type}</span></td>
        <td><span class="badge badge-purple" style="font-size:10px">${m.category}</span></td>
        <td style="font-weight:700;color:${m.transaction_type === 'INFLOW' ? 'var(--green-light)' : 'var(--red-light)'}">${formatRupee(m.amount)}</td>
        <td><span class="badge badge-gray" style="font-size:10px">${m.wallet_type || 'GLOBAL MEGA'}</span></td>
        <td>${m.user_name ? `<span style="font-weight:600">${m.user_name}</span> <span style="font-family:monospace;font-size:11px;color:var(--gold)">(${m.user_member_id})</span>` : '—'}</td>
        <td style="font-size:11px;color:var(--text-secondary)">${m.description || '—'}</td>
      </tr>
    `).join('');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="8" style="color:var(--red-light)">⚠️ ${err.message}</td></tr>`;
  }
}

// ── PAGE SWITCHING ─────────────────────────────────────────────────────────────
const origSwitch = switchPage;
window.switchPage = function(pageId) {
  origSwitch(pageId);
  const headings = {
    dashboard: 'Dashboard Overview', tree: 'Network Tree', megaledger: 'Mega Ledger Audit',
    members: 'All Members', deposits: 'Fund Deposits', withdrawals: 'Withdrawal Requests',
    transactions: 'All Transactions', inquiries: 'Website Inquiries'
  };
  document.getElementById('page-heading').textContent = headings[pageId] || '';
  if (pageId === 'dashboard')    loadDashboard();
  if (pageId === 'tree')         renderAdminTree();
  if (pageId === 'megaledger')   loadMegaLedger();
  if (pageId === 'members')      loadMembers();
  if (pageId === 'deposits')     loadDeposits();
  if (pageId === 'withdrawals')  loadWithdrawals();
  if (pageId === 'transactions') loadTransactions();
  if (pageId === 'inquiries')    loadInquiries();

  const sidebar = document.getElementById('sidebar');
  const backdrop = document.getElementById('sidebar-backdrop');
  if (sidebar) sidebar.classList.remove('open');
  if (backdrop) backdrop.classList.remove('show');
};


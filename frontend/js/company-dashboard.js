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
    renderTxnWidget(txns.slice(0, 8));

    const pc = deposits.filter(d => d.status === 'pending').length;
    const badge = document.getElementById('pending-badge');
    badge.textContent = pc;
    badge.style.display = pc > 0 ? 'inline-block' : 'none';
  } catch (err) {
    showToast('Dashboard load failed: ' + err.message, 'error');
  }
}

function renderStats(s) {
  const netBalance = s.net_company_balance !== undefined ? s.net_company_balance : (parseFloat(s.total_funds_collected || 0) - parseFloat(s.total_payouts || 0));
  document.getElementById('stats-grid').innerHTML = `
    <div class="stat-card green"><span class="stat-icon">🏦</span>
      <div class="stat-value green">${formatRupee(netBalance)}</div>
      <div class="stat-label">Net Available Company Funds</div></div>
    <div class="stat-card gold"><span class="stat-icon">💰</span>
      <div class="stat-value gold">${formatRupee(s.total_funds_collected)}</div>
      <div class="stat-label">Total Deposits Collected</div></div>
    <div class="stat-card red"><span class="stat-icon">💸</span>
      <div class="stat-value red">${formatRupee(s.total_payouts || 0)}</div>
      <div class="stat-label">Total Payouts Paid Out</div></div>
    <div class="stat-card green" style="cursor:pointer" onclick="switchPage('members');setMemberFilter('active')" title="Click to view Active Members"><span class="stat-icon">🟢</span>
      <div class="stat-value green">${s.active_members}</div>
      <div class="stat-label">Active Members (Click to view)</div></div>
    <div class="stat-card red" style="cursor:pointer" onclick="switchPage('members');setMemberFilter('inactive')" title="Click to view Inactive Members"><span class="stat-icon">🔴</span>
      <div class="stat-value red">${s.inactive_members}</div>
      <div class="stat-label">Inactive Members (Click to view)</div></div>
    <div class="stat-card green" style="cursor:pointer" onclick="switchPage('members');setMemberFilter('all')" title="Click to view All Members"><span class="stat-icon">👥</span>
      <div class="stat-value green">${s.total_members}</div>
      <div class="stat-label">Total Members</div></div>
    <div class="stat-card gold"><span class="stat-icon">🤝</span>
      <div class="stat-value gold">${formatRupee(s.total_pair_paid)}</div>
      <div class="stat-label">Pair Income Paid</div></div>
    <div class="stat-card purple"><span class="stat-icon">🔗</span>
      <div class="stat-value purple">${formatRupee(s.total_referral_paid)}</div>
      <div class="stat-label">Referral Paid</div></div>
    <div class="stat-card blue"><span class="stat-icon">🏠</span>
      <div class="stat-value" style="color:var(--blue-light)">${formatRupee(s.total_smi_paid)}</div>
      <div class="stat-label">SMI Family Bonus Paid</div></div>
    <div class="stat-card red" style="cursor:pointer" onclick="switchPage('deposits')" title="Click to view Pending Actions"><span class="stat-icon">⏳</span>
      <div class="stat-value red">${parseInt(s.pending_deposits) + parseInt(s.pending_kyc)}</div>
      <div class="stat-label">Pending Actions</div></div>`;
}

function renderPendingWidget(deps) {
  const el = document.getElementById('dash-pending-deposits');
  if (!deps.length) { el.innerHTML = '<div class="empty-state"><div class="icon">✅</div><p>No pending approvals</p></div>'; return; }
  el.innerHTML = `<div class="table-wrapper"><table>
    <thead><tr><th>ID</th><th>Member</th><th>Amount</th><th>UTR</th><th>Action</th></tr></thead>
    <tbody>${deps.map(d => `<tr>
      <td><span class="badge badge-purple" style="font-family:monospace">${d.user_member_id || '—'}</span></td>
      <td><div style="font-weight:600">${d.user_name}</div></td>
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
      <td style="font-weight:600">${t.user_name}</td>
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
        nodeWidth: 155, nodeHeight: 65, levelGap: 95, siblingGap: 24,
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
      <div class="income-item"><div class="income-amount" style="color:var(--blue-light)">${parseFloat(node.left_pv || 0).toFixed(1)}</div><div class="income-label">Left PV</div></div>
      <div class="income-item"><div class="income-amount" style="color:var(--blue-light)">${parseFloat(node.right_pv || 0).toFixed(1)}</div><div class="income-label">Right PV</div></div>
      <div class="income-item"><div class="income-amount" style="color:var(--purple-light)">${node.referral_code}</div><div class="income-label">Ref Code</div></div>
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
      </div>` : ''}`;

  const leftFree  = !node.left_child_id;
  const rightFree = !node.right_child_id;
  document.getElementById('node-add-left-btn').disabled  = !leftFree;
  document.getElementById('node-add-right-btn').disabled = !rightFree;
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
  openAddUserModal(selectedNodeData?.member_id || 'SP0000', pos);
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

function filterMembersTable() {
  const query = (document.getElementById('member-search-input')?.value || '').toLowerCase().trim();
  
  let filtered = allMembersCache.filter(m => {
    // Status filter
    if (currentMemberFilter === 'active' && !m.is_active) return false;
    if (currentMemberFilter === 'inactive' && m.is_active) return false;
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
    <td><span class="badge badge-purple" style="font-family:monospace;font-weight:700">${m.member_id}</span></td>
    <td><div style="font-weight:600">${m.name}</div><div style="font-size:11px;color:var(--text-muted)">${m.email}</div></td>
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
    <td>
      <button class="btn btn-ghost btn-sm" style="color:var(--gold)" onclick="resetMemberPassword('${m.member_id}', '${m.name.replace(/'/g, "\\'")}')" title="Reset Member Password">🔑 Reset Pwd</button>
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
        <td><span class="badge badge-purple" style="font-family:monospace;font-weight:700">${d.user_member_id || '—'}</span></td>
        <td><div style="font-weight:600">${d.user_name}</div><div style="font-size:11px;color:var(--text-muted)">${d.user_email}</div></td>
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

function openAddUserModal(parentId = 'SP0000', pos = '') {
  document.getElementById('add-user-alert').innerHTML = '';
  document.getElementById('add-user-form').reset();
  document.getElementById('new-parent').value = parentId || 'SP0000';
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
    const res = await apiCall('POST', '/admin/add-user', {
      name:               document.getElementById('new-name').value,
      email:              document.getElementById('new-email').value,
      phone:              document.getElementById('new-phone').value,
      parent_member_id:   document.getElementById('new-parent').value,
      position:           document.getElementById('new-position').value,
      sponsor_member_id:  document.getElementById('new-sponsor')?.value || '',
      password:           tempPassword
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

// ── PAGE SWITCHING ─────────────────────────────────────────────────────────────
const origSwitch = switchPage;
window.switchPage = function(pageId) {
  origSwitch(pageId);
  const headings = {
    dashboard: 'Dashboard Overview', tree: 'Network Tree',
    members: 'All Members', deposits: 'Fund Deposits', transactions: 'All Transactions',
    inquiries: 'Website Inquiries'
  };
  document.getElementById('page-heading').textContent = headings[pageId] || '';
  if (pageId === 'dashboard')    loadDashboard();
  if (pageId === 'tree')         renderAdminTree();
  if (pageId === 'members')      loadMembers();
  if (pageId === 'deposits')     loadDeposits();
  if (pageId === 'transactions') loadTransactions();
  if (pageId === 'inquiries')    loadInquiries();

  const sidebar = document.getElementById('sidebar');
  const backdrop = document.getElementById('sidebar-backdrop');
  if (sidebar) sidebar.classList.remove('open');
  if (backdrop) backdrop.classList.remove('show');
};


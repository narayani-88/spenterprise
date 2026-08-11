let cmsToken = localStorage.getItem('cmsToken');

document.addEventListener('DOMContentLoaded', () => {
  if (cmsToken) {
    showCMSDashboard();
  } else {
    showCMSLogin();
  }
});

function showCMSLogin() {
  document.getElementById('cms-login-page').style.display = 'flex';
  document.getElementById('cms-dashboard-page').style.display = 'none';
}

function showCMSDashboard() {
  document.getElementById('cms-login-page').style.display = 'none';
  document.getElementById('cms-dashboard-page').style.display = 'flex';
  loadCMSData();
}

// ── CMS Login ────────────────────────────────────────────────────────────────
document.getElementById('cms-login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const alertEl = document.getElementById('cms-login-alert');
  alertEl.style.display = 'none';
  const email = document.getElementById('cms-email').value;
  const password = document.getElementById('cms-password').value;

  try {
    const res = await fetch('/api/cms/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'CMS Login failed');

    cmsToken = data.token;
    localStorage.setItem('cmsToken', cmsToken);
    showCMSDashboard();
  } catch (err) {
    alertEl.innerHTML = `<div class="alert alert-error">⚠️ ${err.message}</div>`;
    alertEl.style.display = 'block';
  }
});

function logoutCMS() {
  localStorage.removeItem('cmsToken');
  cmsToken = null;
  showCMSLogin();
}

// ── Tab Switch ───────────────────────────────────────────────────────────────
function switchCMSPage(page) {
  document.querySelectorAll('#cms-dashboard-page .page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('#cms-dashboard-page .nav-item').forEach(n => n.classList.remove('active'));

  document.getElementById(`cms-page-${page}`).classList.add('active');
  document.getElementById(`cms-nav-${page}`).classList.add('active');

  const titles = {
    hero: 'Hero & Home Banner',
    features: 'Homepage Features & CTA',
    about: 'About Company & Stats',
    contact: 'Contact & Bank Info',
    messages: 'Inquiry Messages'
  };
  document.getElementById('cms-page-heading').textContent = titles[page];

  if (page === 'messages') loadCMSMessages();
}

// ── Load CMS Content Into Inputs ─────────────────────────────────────────────
async function loadCMSData() {
  try {
    const res = await fetch('/api/cms/content');
    if (!res.ok) return;
    const data = await res.json();

    for (const [key, val] of Object.entries(data)) {
      const input = document.getElementById(`edit_${key}`);
      if (input) input.value = val;
    }
  } catch (err) {
    console.error('Failed to load CMS data:', err);
  }
}

// ── Save CMS Content ─────────────────────────────────────────────────────────
async function saveCMSContent(section) {
  const alertEl = document.getElementById(`cms-${section}-alert`);
  alertEl.innerHTML = '';

  const form = document.getElementById(`cms-${section}-form`);
  const inputs = form.querySelectorAll('input, textarea');
  const payload = {};

  inputs.forEach(input => {
    const key = input.id.replace('edit_', '');
    payload[key] = input.value;
  });

  try {
    const res = await fetch('/api/cms/content', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${cmsToken}`
      },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to save');

    alertEl.innerHTML = `<div class="alert alert-success">✅ ${data.message}</div>`;
    setTimeout(() => { alertEl.innerHTML = ''; }, 4000);
  } catch (err) {
    alertEl.innerHTML = `<div class="alert alert-error">⚠️ ${err.message}</div>`;
  }
}

// ── Load Messages ────────────────────────────────────────────────────────────
async function loadCMSMessages() {
  const tbody = document.getElementById('cms-messages-table');
  tbody.innerHTML = '<tr><td colspan="6"><div class="loading"><div class="spinner"></div></div></td></tr>';

  try {
    const res = await fetch('/api/cms/contacts', {
      headers: { 'Authorization': `Bearer ${cmsToken}` }
    });
    if (!res.ok) throw new Error('Failed to load messages');
    const rows = await res.json();

    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--text-muted);padding:30px">No inquiry messages received yet.</td></tr>';
      document.getElementById('unread-messages-badge').style.display = 'none';
      return;
    }

    let unreadCount = 0;
    tbody.innerHTML = rows.map(m => {
      if (!m.is_read) unreadCount++;
      const dateStr = new Date(m.created_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
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
          <td>
            ${!m.is_read ? `<button class="btn btn-ghost btn-sm" onclick="markMessageRead(${m.id})">Mark Read</button>` : '—'}
          </td>
        </tr>
      `;
    }).join('');

    const badge = document.getElementById('unread-messages-badge');
    if (unreadCount > 0) {
      badge.textContent = unreadCount;
      badge.style.display = 'inline-block';
    } else {
      badge.style.display = 'none';
    }
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="6" style="color:var(--red-light)">⚠️ ${err.message}</td></tr>`;
  }
}

async function markMessageRead(id) {
  try {
    await fetch(`/api/cms/contacts/${id}/read`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${cmsToken}` }
    });
    loadCMSMessages();
  } catch (err) {
    console.error(err);
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

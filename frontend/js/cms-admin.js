let cmsToken = localStorage.getItem('cmsToken');

document.addEventListener('DOMContentLoaded', async () => {
  if (cmsToken) {
    try {
      const res = await fetch('/api/cms/verify', {
        headers: { 'Authorization': `Bearer ${cmsToken}` }
      });
      if (res.ok) {
        showCMSDashboard();
      } else {
        handleCMSAuthExpired('Your CMS session has expired or is invalid. Please sign in again.');
      }
    } catch {
      showCMSDashboard();
    }
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

function handleCMSAuthExpired(msg = 'Your CMS session has expired. Please sign in again.') {
  localStorage.removeItem('cmsToken');
  cmsToken = null;
  showCMSLogin();
  const alertEl = document.getElementById('cms-login-alert');
  if (alertEl) {
    alertEl.innerHTML = `<div class="alert alert-error">⚠️ ${escapeHtml(msg)}</div>`;
    alertEl.style.display = 'block';
  }
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

function toggleMobileSidebar() {
  const sidebar = document.getElementById('sidebar');
  const backdrop = document.getElementById('sidebar-backdrop');
  if (sidebar) sidebar.classList.toggle('open');
  if (backdrop) backdrop.classList.toggle('show');
}

// ── Tab Switch ───────────────────────────────────────────────────────────────
function switchCMSPage(page) {
  document.querySelectorAll('#cms-dashboard-page .page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('#cms-dashboard-page .nav-item').forEach(n => n.classList.remove('active'));
  document.querySelectorAll('.mobile-tab-bar .tab-item').forEach(t => t.classList.remove('active'));

  const targetPage = document.getElementById(`cms-page-${page}`);
  const targetNav = document.getElementById(`cms-nav-${page}`);
  const targetMobileTab = document.getElementById(`mobile-tab-${page}`);

  if (targetPage) targetPage.classList.add('active');
  if (targetNav) targetNav.classList.add('active');
  if (targetMobileTab) targetMobileTab.classList.add('active');

  const titles = {
    properties: '🏡 Plot & Property Management',
    hero: 'Hero & Home Banner',
    features: 'Homepage Features & CTA',
    about: 'About Company & Stats',
    contact: 'Contact & Bank Info',
    messages: 'Inquiry Messages'
  };
  if (document.getElementById('cms-page-heading')) {
    document.getElementById('cms-page-heading').textContent = titles[page] || 'CMS Admin';
  }

  if (page === 'messages') loadCMSMessages();
  if (page === 'properties') loadCMSProperties();

  const sidebar = document.getElementById('sidebar');
  const backdrop = document.getElementById('sidebar-backdrop');
  if (sidebar) sidebar.classList.remove('open');
  if (backdrop) backdrop.classList.remove('show');
}


// ── Load CMS Content Into Inputs ─────────────────────────────────────────────
async function loadCMSData() {
  try {
    const res = await fetch('/api/cms/content');
    if (res.ok) {
      const data = await res.json();
      for (const [key, val] of Object.entries(data)) {
        const input = document.getElementById(`edit_${key}`);
        if (input) input.value = val;
      }
    }
    // Also load properties count & messages count
    loadCMSProperties();
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
    if (res.status === 401) {
      handleCMSAuthExpired();
      return;
    }
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
    if (res.status === 401) {
      handleCMSAuthExpired();
      return;
    }
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
    const res = await fetch(`/api/cms/contacts/${id}/read`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${cmsToken}` }
    });
    if (res.status === 401) {
      handleCMSAuthExpired();
      return;
    }
    loadCMSMessages();
  } catch (err) {
    console.error(err);
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ── PROPERTY MANAGEMENT LOGIC ────────────────────────────────────────────────
let cachedProperties = [];

async function loadCMSProperties() {
  const tbody = document.getElementById('cms-properties-table');
  if (tbody) {
    tbody.innerHTML = '<tr><td colspan="7"><div class="loading"><div class="spinner"></div></div></td></tr>';
  }

  try {
    const res = await fetch('/api/cms/properties?status=all');
    if (!res.ok) throw new Error('Failed to load properties');
    const data = await res.json();
    cachedProperties = data.properties || [];

    // Update Stats & Badges
    const total = cachedProperties.length;
    const available = cachedProperties.filter(p => p.status === 'available').length;
    const reserved = cachedProperties.filter(p => p.status === 'reserved').length;
    const sold = cachedProperties.filter(p => p.status === 'sold').length;

    if (document.getElementById('prop-stat-total')) document.getElementById('prop-stat-total').textContent = total;
    if (document.getElementById('prop-stat-available')) document.getElementById('prop-stat-available').textContent = available;
    if (document.getElementById('prop-stat-reserved')) document.getElementById('prop-stat-reserved').textContent = reserved;
    if (document.getElementById('prop-stat-sold')) document.getElementById('prop-stat-sold').textContent = sold;

    const badge = document.getElementById('properties-count-badge');
    if (badge) {
      badge.textContent = total;
      badge.style.display = total > 0 ? 'inline-block' : 'none';
    }

    renderPropertiesTable(cachedProperties);
  } catch (err) {
    if (tbody) {
      tbody.innerHTML = `<tr><td colspan="7" style="color:var(--red-light);padding:24px">⚠️ ${err.message}</td></tr>`;
    }
  }
}

function renderPropertiesTable(properties) {
  const tbody = document.getElementById('cms-properties-table');
  if (!tbody) return;

  if (!properties || properties.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--text-muted);padding:36px">No plots found. Click <strong>"➕ Add New Plot"</strong> above to publish your first property!</td></tr>';
    return;
  }

  tbody.innerHTML = properties.map(p => {
    const thumb = (p.images && p.images.length > 0)
      ? `<img src="${escapeHtml(p.images[0])}" style="width:70px;height:52px;object-fit:cover;border-radius:6px;border:1px solid var(--border)">`
      : `<div style="width:70px;height:52px;background:rgba(255,255,255,0.03);border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:22px">🏡</div>`;

    const statusBadge = p.status === 'available'
      ? '<span class="badge badge-emerald">Available</span>'
      : p.status === 'reserved'
        ? '<span class="badge badge-gold">Reserved</span>'
        : '<span class="badge badge-red">Sold</span>';

    const videoIcon = p.video_url
      ? '<span title="Has walkthrough video" style="display:inline-block;margin-left:4px;cursor:pointer">🎥</span>'
      : '';

    const featuredStar = p.is_featured
      ? '<span title="Featured Plot" style="color:var(--gold);margin-right:4px">⭐</span>'
      : '';

    return `
      <tr>
        <td>
          <a href="/property-detail.html?id=${p.id}" target="_blank" style="display:block">
            ${thumb}
          </a>
        </td>
        <td style="max-width:280px">
          <div style="font-weight:700;color:var(--text-primary);font-size:14px;margin-bottom:3px">
            ${featuredStar}<a href="/property-detail.html?id=${p.id}" target="_blank" style="color:inherit;text-decoration:none">${escapeHtml(p.title)}</a> ${videoIcon}
          </div>
          <div style="color:var(--text-secondary);font-size:12.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
            📍 ${escapeHtml(p.address)}${p.city ? `, ${escapeHtml(p.city)}` : ''}
          </div>
        </td>
        <td>
          <div style="font-weight:600;font-size:13px">${escapeHtml(p.property_type || 'Residential Plot')}</div>
          <div style="color:var(--text-secondary);font-size:12px">${p.area_sqft ? p.area_sqft + ' sq.ft' : '—'} ${p.dimensions ? `(${escapeHtml(p.dimensions)})` : ''}</div>
        </td>
        <td>
          <div style="font-weight:800;color:var(--gold-light);font-size:15px">${escapeHtml(p.price_display || ('₹' + Number(p.price).toLocaleString('en-IN')))}</div>
        </td>
        <td>
          <div style="font-size:13px">📞 <a href="tel:${escapeHtml(p.contact_number)}" style="color:var(--blue-light);text-decoration:none">${escapeHtml(p.contact_number)}</a></div>
          ${p.whatsapp_number ? `<div style="font-size:11.5px;color:var(--green-light)">💬 WhatsApp ready</div>` : ''}
        </td>
        <td>${statusBadge}</td>
        <td style="text-align:right;white-space:nowrap">
          <button class="btn btn-ghost btn-sm" onclick="editProperty(${p.id})" style="padding:4px 10px;font-size:12px">✏️ Edit</button>
          <a href="/property-detail.html?id=${p.id}" target="_blank" class="btn btn-ghost btn-sm" style="padding:4px 10px;font-size:12px" title="View live detail page">Live ↗</a>
          <button class="btn btn-ghost btn-sm" onclick="deleteProperty(${p.id}, '${escapeHtml(p.title).replace(/'/g, "\\'")}')" style="padding:4px 10px;font-size:12px;color:var(--red-light)">🗑️</button>
        </td>
      </tr>
    `;
  }).join('');
}

function filterLocalProperties() {
  const query = (document.getElementById('prop-table-search')?.value || '').toLowerCase().trim();
  const status = document.getElementById('prop-table-status-filter')?.value || 'all';

  const filtered = cachedProperties.filter(p => {
    const matchesStatus = status === 'all' || p.status === status;
    const matchesQuery = !query || 
      (p.title && p.title.toLowerCase().includes(query)) ||
      (p.address && p.address.toLowerCase().includes(query)) ||
      (p.city && p.city.toLowerCase().includes(query)) ||
      (p.property_type && p.property_type.toLowerCase().includes(query));
    return matchesStatus && matchesQuery;
  });

  renderPropertiesTable(filtered);
}

// ── Open / Close Property Form ────────────────────────────────────────────────
function openPropertyForm(prop = null) {
  const card = document.getElementById('property-form-card');
  const alertEl = document.getElementById('prop-form-alert');
  if (alertEl) alertEl.innerHTML = '';

  if (prop) {
    // Edit Mode
    document.getElementById('prop-form-title').textContent = `✏️ Edit Plot #${prop.id} — ${prop.title}`;
    document.getElementById('prop-save-btn').textContent = '💾 Update Plot';
    document.getElementById('prop_id').value = prop.id;
    document.getElementById('prop_title').value = prop.title || '';
    document.getElementById('prop_type').value = prop.property_type || 'Residential Plot';
    document.getElementById('prop_price').value = prop.price || '';
    document.getElementById('prop_price_display').value = prop.price_display || '';
    document.getElementById('prop_area_sqft').value = prop.area_sqft || '';
    document.getElementById('prop_dimensions').value = prop.dimensions || '';
    document.getElementById('prop_facing').value = prop.facing || '';
    document.getElementById('prop_road_width').value = prop.road_width || '';
    document.getElementById('prop_address').value = prop.address || '';
    document.getElementById('prop_city').value = prop.city || '';
    document.getElementById('prop_state').value = prop.state || '';
    document.getElementById('prop_pincode').value = prop.pincode || '';
    document.getElementById('prop_contact_number').value = prop.contact_number || '';
    document.getElementById('prop_whatsapp_number').value = prop.whatsapp_number || '';

    const featuresText = Array.isArray(prop.features) ? prop.features.join('\n') : (prop.features || '');
    document.getElementById('prop_features').value = featuresText;

    const imagesText = Array.isArray(prop.images) ? prop.images.join('\n') : (prop.images || '');
    document.getElementById('prop_images_urls').value = imagesText;

    document.getElementById('prop_video_url').value = prop.video_url || '';
    document.getElementById('prop_description').value = prop.description || '';
    document.getElementById('prop_status').value = prop.status || 'available';
    document.getElementById('prop_is_featured').checked = Boolean(prop.is_featured);
  } else {
    // Add Mode
    document.getElementById('prop-form-title').textContent = '➕ Add New Plot / Property';
    document.getElementById('prop-save-btn').textContent = '💾 Publish Plot';
    document.getElementById('cms-property-form').reset();
    document.getElementById('prop_id').value = '';
    document.getElementById('prop_status').value = 'available';
    document.getElementById('prop_contact_number').value = '+91 98765 43210';
    document.getElementById('prop_whatsapp_number').value = '+91 98765 43210';
  }

  renderImagePreviews();
  renderVideoPreview();

  card.style.display = 'block';
  card.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function closePropertyForm() {
  const card = document.getElementById('property-form-card');
  if (card) card.style.display = 'none';
  const alertEl = document.getElementById('prop-form-alert');
  if (alertEl) alertEl.innerHTML = '';
}

function appendFeature(text) {
  const textarea = document.getElementById('prop_features');
  if (!textarea) return;
  const current = textarea.value.trim();
  if (current.includes(text)) return;
  textarea.value = current ? `${current}\n${text}` : text;
}

// ── Images & Video Previews ──────────────────────────────────────────────────
function renderImagePreviews() {
  const container = document.getElementById('prop-images-preview-strip');
  if (!container) return;
  const val = document.getElementById('prop_images_urls')?.value || '';
  const lines = val.split('\n').map(l => l.trim()).filter(Boolean);

  if (lines.length === 0) {
    container.innerHTML = '';
    return;
  }

  container.innerHTML = lines.map((url, idx) => `
    <div class="image-preview-item">
      <img src="${escapeHtml(url)}" onerror="this.src='https://placehold.co/100x80?text=Invalid+Image'">
      <button type="button" class="image-preview-remove" onclick="removeImagePreview(${idx})" title="Remove image">✕</button>
    </div>
  `).join('');
}

function removeImagePreview(idx) {
  const textarea = document.getElementById('prop_images_urls');
  if (!textarea) return;
  const lines = textarea.value.split('\n').map(l => l.trim()).filter(Boolean);
  lines.splice(idx, 1);
  textarea.value = lines.join('\n');
  renderImagePreviews();
}

function renderVideoPreview() {
  const container = document.getElementById('prop-video-preview');
  if (!container) return;
  const url = (document.getElementById('prop_video_url')?.value || '').trim();

  if (!url) {
    container.style.display = 'none';
    container.innerHTML = '';
    return;
  }

  // Check if YouTube
  const ytMatch = url.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=))([\w-]{11})/);
  if (ytMatch && ytMatch[1]) {
    container.style.display = 'block';
    container.innerHTML = `
      <div style="font-size:12px;color:var(--text-secondary);margin-bottom:6px">YouTube Preview:</div>
      <div style="position:relative;padding-bottom:56.25%;height:0;overflow:hidden;border-radius:8px">
        <iframe src="https://www.youtube.com/embed/${ytMatch[1]}" frameborder="0" allowfullscreen style="position:absolute;top:0;left:0;width:100%;height:100%"></iframe>
      </div>
    `;
    return;
  }

  // Check if Vimeo
  const vimeoMatch = url.match(/vimeo\.com\/(\d+)/);
  if (vimeoMatch && vimeoMatch[1]) {
    container.style.display = 'block';
    container.innerHTML = `
      <div style="font-size:12px;color:var(--text-secondary);margin-bottom:6px">Vimeo Preview:</div>
      <div style="position:relative;padding-bottom:56.25%;height:0;overflow:hidden;border-radius:8px">
        <iframe src="https://player.vimeo.com/video/${vimeoMatch[1]}" frameborder="0" allowfullscreen style="position:absolute;top:0;left:0;width:100%;height:100%"></iframe>
      </div>
    `;
    return;
  }

  // Direct video file (mp4, webm)
  if (url.endsWith('.mp4') || url.endsWith('.webm') || url.includes('/uploads/properties/')) {
    container.style.display = 'block';
    container.innerHTML = `
      <div style="font-size:12px;color:var(--text-secondary);margin-bottom:6px">Video File Preview:</div>
      <video src="${escapeHtml(url)}" controls style="width:100%;max-height:220px;border-radius:8px;background:#000"></video>
    `;
    return;
  }

  container.style.display = 'none';
  container.innerHTML = '';
}

// ── File Upload Handlers ─────────────────────────────────────────────────────
async function uploadPlotImages() {
  const fileInput = document.getElementById('prop_image_file_input');
  const statusEl = document.getElementById('upload-images-status');
  if (!fileInput || !fileInput.files || fileInput.files.length === 0) {
    alert('Please select one or more image files first.');
    return;
  }

  statusEl.textContent = 'Uploading...';

  const formData = new FormData();
  for (let i = 0; i < fileInput.files.length; i++) {
    formData.append('files', fileInput.files[i]);
  }

  try {
    const res = await fetch('/api/cms/upload', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${cmsToken}` },
      body: formData
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Upload failed');

    const textarea = document.getElementById('prop_images_urls');
    const existing = textarea.value.trim();
    const newUrls = data.files.join('\n');
    textarea.value = existing ? `${existing}\n${newUrls}` : newUrls;

    renderImagePreviews();
    fileInput.value = '';
    statusEl.textContent = `✅ ${data.files.length} photo(s) uploaded successfully!`;
    setTimeout(() => { statusEl.textContent = ''; }, 4000);
  } catch (err) {
    statusEl.textContent = `❌ ${err.message}`;
  }
}

async function uploadPlotVideo() {
  const fileInput = document.getElementById('prop_video_file_input');
  const statusEl = document.getElementById('upload-video-status');
  if (!fileInput || !fileInput.files || fileInput.files.length === 0) {
    alert('Please select a video file first (MP4 / WebM).');
    return;
  }

  statusEl.textContent = 'Uploading video (may take a moment)...';

  const formData = new FormData();
  formData.append('files', fileInput.files[0]);

  try {
    const res = await fetch('/api/cms/upload', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${cmsToken}` },
      body: formData
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Video upload failed');

    const videoUrl = data.files[0];
    document.getElementById('prop_video_url').value = videoUrl;
    renderVideoPreview();

    fileInput.value = '';
    statusEl.textContent = '✅ Walkthrough video uploaded successfully!';
    setTimeout(() => { statusEl.textContent = ''; }, 4000);
  } catch (err) {
    statusEl.textContent = `❌ ${err.message}`;
  }
}

// ── Submit Add / Edit Property ───────────────────────────────────────────────
async function handlePropertySubmit(e) {
  e.preventDefault();
  const alertEl = document.getElementById('prop-form-alert');
  const saveBtn = document.getElementById('prop-save-btn');
  alertEl.innerHTML = '';

  const id = document.getElementById('prop_id').value;
  const title = document.getElementById('prop_title').value.trim();
  const property_type = document.getElementById('prop_type').value;
  const price = document.getElementById('prop_price').value;
  const price_display = document.getElementById('prop_price_display').value.trim();
  const area_sqft = document.getElementById('prop_area_sqft').value;
  const dimensions = document.getElementById('prop_dimensions').value.trim();
  const facing = document.getElementById('prop_facing').value;
  const road_width = document.getElementById('prop_road_width').value.trim();
  const address = document.getElementById('prop_address').value.trim();
  const city = document.getElementById('prop_city').value.trim();
  const state = document.getElementById('prop_state').value.trim();
  const pincode = document.getElementById('prop_pincode').value.trim();
  const contact_number = document.getElementById('prop_contact_number').value.trim();
  const whatsapp_number = document.getElementById('prop_whatsapp_number').value.trim();

  const features = document.getElementById('prop_features').value
    .split('\n')
    .map(s => s.trim())
    .filter(Boolean);

  const images = document.getElementById('prop_images_urls').value
    .split('\n')
    .map(s => s.trim())
    .filter(Boolean);

  const video_url = document.getElementById('prop_video_url').value.trim();
  const description = document.getElementById('prop_description').value.trim();
  const status = document.getElementById('prop_status').value;
  const is_featured = document.getElementById('prop_is_featured').checked;

  if (!title || !price || !address || !contact_number) {
    alertEl.innerHTML = '<div class="alert alert-error">⚠️ Please fill in all required fields (Title, Rate, Address, Contact Number).</div>';
    return;
  }

  const payload = {
    title,
    property_type,
    price: parseFloat(price),
    price_display,
    area_sqft: area_sqft ? parseFloat(area_sqft) : null,
    dimensions,
    facing,
    road_width,
    address,
    city,
    state,
    pincode,
    features,
    contact_number,
    whatsapp_number,
    images,
    video_url,
    description,
    status,
    is_featured
  };

  saveBtn.disabled = true;
  saveBtn.textContent = 'Saving...';

  try {
    const url = id ? `/api/cms/properties/${id}` : '/api/cms/properties';
    const method = id ? 'PUT' : 'POST';

    const res = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${cmsToken}`
      },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to save property');

    alertEl.innerHTML = `<div class="alert alert-success">✅ ${data.message}</div>`;
    await loadCMSProperties();

    setTimeout(() => {
      closePropertyForm();
      saveBtn.disabled = false;
    }, 1200);
  } catch (err) {
    alertEl.innerHTML = `<div class="alert alert-error">⚠️ ${err.message}</div>`;
    saveBtn.disabled = false;
    saveBtn.textContent = id ? '💾 Update Plot' : '💾 Publish Plot';
  }
}

function editProperty(id) {
  const prop = cachedProperties.find(p => p.id === id);
  if (!prop) {
    alert('Property not found');
    return;
  }
  openPropertyForm(prop);
}

async function deleteProperty(id, title) {
  if (!confirm(`Are you sure you want to delete plot "${title}"?\nThis action cannot be undone.`)) {
    return;
  }

  try {
    const res = await fetch(`/api/cms/properties/${id}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${cmsToken}` }
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to delete');

    await loadCMSProperties();
  } catch (err) {
    alert('Error: ' + err.message);
  }
}


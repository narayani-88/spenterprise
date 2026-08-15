// Shared API utility
const API_BASE = '/api';

function getToken() { return localStorage.getItem('token'); }
function getUser() { return JSON.parse(localStorage.getItem('user') || 'null'); }

function logout() {
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  window.location.href = '/';
}

function requireAuth(role = null) {
  const token = getToken();
  const user = getUser();
  if (!token || !user) { window.location.href = '/'; return false; }
  if (role && user.role !== role) { window.location.href = '/'; return false; }
  return true;
}

async function apiCall(method, endpoint, body = null) {
  const opts = {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${getToken()}`
    },
    cache: 'no-store'
  };
  if (body) opts.body = JSON.stringify(body);

  const res = await fetch(`${API_BASE}${endpoint}`, opts);
  const data = await res.json();
  if (res.status === 401) { logout(); }
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

// Toast notifications
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  const icons = { success: '✅', error: '❌', info: 'ℹ️', warning: '⚠️' };
  toast.innerHTML = `<span>${icons[type] || 'ℹ️'}</span><span>${message}</span>`;
  container.appendChild(toast);
  setTimeout(() => { toast.style.opacity = '0'; toast.style.transform = 'translateX(20px)'; toast.style.transition = '0.3s'; setTimeout(() => toast.remove(), 300); }, 3500);
}

// Currency formatter
function formatRupee(amount) {
  return '₹' + parseFloat(amount || 0).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function formatDate(dateStr) {
  return new Date(dateStr).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function formatDateTime(dateStr) {
  return new Date(dateStr).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

// Navigation helper
function switchPage(pageId) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const page = document.getElementById('page-' + pageId);
  const nav = document.getElementById('nav-' + pageId);
  if (page) page.classList.add('active');
  if (nav) nav.classList.add('active');
}

// Tree renderer using SVG
class BinaryTreeRenderer {
  constructor(svgId, options = {}) {
    this.svgId = svgId;
    this.nodeWidth = options.nodeWidth || 150;
    this.nodeHeight = options.nodeHeight || 66;
    this.levelGap = options.levelGap || 100;
    this.siblingGap = options.siblingGap || 20;
    this.onNodeClick = options.onNodeClick || null;
    this.svg = null;
    this.g = null;
    this.tooltip = null;
  }

  render(rootData) {
    const svgEl = document.getElementById(this.svgId);
    if (!svgEl) return;
    svgEl.innerHTML = '';

    if (!rootData) {
      svgEl.innerHTML = '<text x="50%" y="50%" text-anchor="middle" fill="#475569" font-family="Inter" font-size="14">No tree data</text>';
      return;
    }

    // Compute layout
    const positions = {};
    let minX = Infinity, maxX = -Infinity;
    let maxDepth = 0;

    const computeLayout = (node, depth, side) => {
      if (!node) return null;
      maxDepth = Math.max(maxDepth, depth);
      const leftTree = computeLayout(node.left, depth + 1, 'left');
      const rightTree = computeLayout(node.right, depth + 1, 'right');

      let x;
      const y = depth * (this.nodeHeight + this.levelGap) + 40;

      if (!leftTree && !rightTree) {
        x = (Object.keys(positions).length) * (this.nodeWidth + this.siblingGap);
      } else if (leftTree && rightTree) {
        x = (positions[leftTree].x + positions[rightTree].x) / 2;
      } else if (leftTree) {
        x = positions[leftTree].x + this.nodeWidth / 2 + this.siblingGap / 2;
      } else {
        x = positions[rightTree].x - this.nodeWidth / 2 - this.siblingGap / 2;
      }

      positions[node.id] = { x, y, node };
      minX = Math.min(minX, x - this.nodeWidth / 2 - 20);
      maxX = Math.max(maxX, x + this.nodeWidth / 2 + 20);
      return node.id;
    };

    computeLayout(rootData, 0, 'root');

    const totalW = maxX - minX + 40;
    const totalH = (maxDepth + 1) * (this.nodeHeight + this.levelGap) + 80;
    const offsetX = -minX + 20;

    svgEl.setAttribute('viewBox', `0 0 ${totalW} ${totalH}`);
    svgEl.setAttribute('height', Math.max(totalH, 400));

    // Draw edges first
    const edgeGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    Object.values(positions).forEach(({ x, y, node }) => {
      ['left', 'right'].forEach(side => {
        if (node[side]) {
          const child = positions[node[side].id];
          if (child) {
            const line = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            const cx = x + offsetX, cy = y + this.nodeHeight / 2;
            const dx = child.x + offsetX, dy = child.y + this.nodeHeight / 2;
            const my = (cy + dy) / 2;
            line.setAttribute('d', `M${cx},${cy} C${cx},${my} ${dx},${my} ${dx},${dy}`);
            line.setAttribute('stroke', side === 'left' ? 'rgba(99,102,241,0.3)' : 'rgba(245,158,11,0.3)');
            line.setAttribute('stroke-width', '2');
            line.setAttribute('fill', 'none');
            line.setAttribute('stroke-dasharray', node[side].is_active ? 'none' : '5,4');
            edgeGroup.appendChild(line);

            // Side label
            const lbl = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            lbl.setAttribute('x', (cx + dx) / 2);
            lbl.setAttribute('y', my - 4);
            lbl.setAttribute('text-anchor', 'middle');
            lbl.setAttribute('font-family', 'Inter');
            lbl.setAttribute('font-size', '10');
            lbl.setAttribute('fill', side === 'left' ? 'rgba(99,102,241,0.6)' : 'rgba(245,158,11,0.6)');
            lbl.textContent = side.toUpperCase();
            edgeGroup.appendChild(lbl);
          }
        }
      });
    });
    svgEl.appendChild(edgeGroup);

    // Draw nodes
    const nodeGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    Object.values(positions).forEach(({ x, y, node }) => {
      const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      g.style.cursor = 'pointer';
      g.setAttribute('transform', `translate(${x + offsetX - this.nodeWidth / 2},${y})`);

      // Background rect
      const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      rect.setAttribute('width', this.nodeWidth);
      rect.setAttribute('height', this.nodeHeight);
      rect.setAttribute('rx', '10');
      const isActive = node.is_active;
      const isAdmin = node.role === 'admin';

      let fillColor = isAdmin ? 'rgba(139,92,246,0.15)' : isActive ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)';
      let strokeColor = isAdmin ? 'rgba(139,92,246,0.5)' : isActive ? 'rgba(16,185,129,0.4)' : 'rgba(239,68,68,0.4)';

      rect.setAttribute('fill', fillColor);
      rect.setAttribute('stroke', strokeColor);
      rect.setAttribute('stroke-width', '1.5');
      g.appendChild(rect);

      // Status dot
      const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      dot.setAttribute('cx', this.nodeWidth - 14);
      dot.setAttribute('cy', 14);
      dot.setAttribute('r', '5');
      dot.setAttribute('fill', isAdmin ? '#8b5cf6' : isActive ? '#10b981' : '#ef4444');
      g.appendChild(dot);

      // Name text (with Member ID)
      const nameText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      nameText.setAttribute('x', this.nodeWidth / 2);
      nameText.setAttribute('y', 22);
      nameText.setAttribute('text-anchor', 'middle');
      nameText.setAttribute('font-family', 'Inter');
      nameText.setAttribute('font-size', '11');
      nameText.setAttribute('font-weight', '600');
      nameText.setAttribute('fill', '#f8fafc');
      const idPrefix = node.member_id ? `[${node.member_id}] ` : '';
      const fullName = idPrefix + node.name;
      const displayName = fullName.length > 17 ? fullName.substring(0, 16) + '…' : fullName;
      nameText.textContent = displayName;
      g.appendChild(nameText);

      // Sub info
      const subText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      subText.setAttribute('x', this.nodeWidth / 2);
      subText.setAttribute('y', 36);
      subText.setAttribute('text-anchor', 'middle');
      subText.setAttribute('font-family', 'Inter');
      subText.setAttribute('font-size', '10');
      subText.setAttribute('fill', isAdmin ? '#a78bfa' : isActive ? '#34d399' : '#f87171');
      const pairInfo = node.role === 'admin' ? 'COMPANY' : `${node.total_pairs || 0} pairs · ₹${parseInt(node.wallet_balance || 0).toLocaleString('en-IN')}`;
      subText.textContent = pairInfo;
      g.appendChild(subText);

      // Downline counts info (Left Count | Right Count)
      const countText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      countText.setAttribute('x', this.nodeWidth / 2);
      countText.setAttribute('y', 51);
      countText.setAttribute('text-anchor', 'middle');
      countText.setAttribute('font-family', 'Inter');
      countText.setAttribute('font-size', '9.5');
      countText.setAttribute('font-weight', '600');
      countText.setAttribute('fill', '#94a3b8');
      countText.textContent = `◀ L: ${node.left_count || 0}  |  R: ${node.right_count || 0} ▶`;
      g.appendChild(countText);

      // Milestone badge
      if (node.milestone_triggered) {
        const badge = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        badge.setAttribute('x', this.nodeWidth - 30);
        badge.setAttribute('y', 14);
        badge.setAttribute('text-anchor', 'end');
        badge.setAttribute('font-family', 'Inter');
        badge.setAttribute('font-size', '9');
        badge.setAttribute('fill', '#fcd34d');
        badge.textContent = '🏆';
        g.appendChild(badge);
      }

      // Add slot indicators at bottom
      if (!node.left_child_id || !node.right_child_id) {
        const slotY = this.nodeHeight - 1;
        if (!node.left_child_id) {
          const lSlot = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
          lSlot.setAttribute('x', '6'); lSlot.setAttribute('y', slotY - 4);
          lSlot.setAttribute('width', this.nodeWidth / 2 - 10); lSlot.setAttribute('height', '4');
          lSlot.setAttribute('rx', '2'); lSlot.setAttribute('fill', 'rgba(99,102,241,0.3)');
          g.appendChild(lSlot);
        }
        if (!node.right_child_id) {
          const rSlot = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
          rSlot.setAttribute('x', this.nodeWidth / 2 + 4); rSlot.setAttribute('y', slotY - 4);
          rSlot.setAttribute('width', this.nodeWidth / 2 - 10); rSlot.setAttribute('height', '4');
          rSlot.setAttribute('rx', '2'); rSlot.setAttribute('fill', 'rgba(245,158,11,0.3)');
          g.appendChild(rSlot);
        }
      }

      // Click handler
      g.addEventListener('click', () => {
        if (this.onNodeClick) this.onNodeClick(node);
      });

      // Hover effect
      g.addEventListener('mouseenter', () => {
        rect.setAttribute('stroke-width', '2.5');
        rect.setAttribute('fill', isAdmin ? 'rgba(139,92,246,0.2)' : isActive ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)');
      });
      g.addEventListener('mouseleave', () => {
        rect.setAttribute('stroke-width', '1.5');
        rect.setAttribute('fill', fillColor);
      });

      nodeGroup.appendChild(g);
    });
    svgEl.appendChild(nodeGroup);
  }
}

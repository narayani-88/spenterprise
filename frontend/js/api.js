// Shared API utility
const API_BASE = '/api';

function getToken() { return localStorage.getItem('token'); }
function getUser() {
  try {
    const raw = localStorage.getItem('user');
    if (!raw) return null;
    let u = JSON.parse(raw);
    if (u && u.name && /apna/i.test(u.name)) {
      u.name = u.name.replace(/apna/gi, 'Mera');
      localStorage.setItem('user', JSON.stringify(u));
    }
    return u;
  } catch (e) {
    return null;
  }
}

function logout() {
  const isCompany = window.location.pathname.includes('company');
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  window.location.href = isCompany ? '/company-login.html' : '/login.html';
}

function requireAuth(role = null) {
  const token = getToken();
  const user = getUser();
  if (!token || !user) { logout(); return false; }
  if (role && user.role !== role) { logout(); return false; }
  return true;
}

async function apiCall(method, endpoint, body = null) {
  const token = getToken();
  const opts = {
    method,
    headers: {
      'Content-Type': 'application/json'
    },
    cache: 'no-store'
  };
  if (token) {
    opts.headers['Authorization'] = `Bearer ${token}`;
  }
  if (body) opts.body = JSON.stringify(body);

  const res = await fetch(`${API_BASE}${endpoint}`, opts);
  const data = await res.json();
  if (res.status === 401) {
    logout();
    throw new Error(data.error || 'Session expired. Please log in again.');
  }
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

// CMS Content refresh mechanism
window.refreshCMSContent = function() {
  // Trigger a storage event to notify all tabs to refresh CMS content
  localStorage.setItem('cms_refresh_trigger', Date.now().toString());
  // Immediately clear to prevent infinite loops
  localStorage.removeItem('cms_refresh_trigger');
};

// Listen for CMS refresh events from other tabs
window.addEventListener('storage', function(e) {
  if (e.key === 'cms_refresh_trigger') {
    // Reload CMS content on this page
    if (typeof loadCMSContent === 'function') {
      loadCMSContent();
    }
  }
});

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

  // Auto-close mobile sidebar drawer upon navigation
  const sidebar = document.getElementById('sidebar');
  const backdrop = document.getElementById('sidebar-backdrop');
  if (sidebar) sidebar.classList.remove('open');
  if (backdrop) backdrop.classList.remove('show');
}

// Tree renderer using SVG matching classic binary MLM reference design
class BinaryTreeRenderer {
  constructor(svgId, options = {}) {
    this.svgId = svgId;
    this.maxDepth = options.maxDepth !== undefined ? options.maxDepth : 0; // Start collapsed (only root visible)
    this.nodeRadius = options.nodeRadius || 24;
    this.levelGap = options.levelGap || 140;
    this.siblingGap = options.siblingGap || 60;
    this.onNodeClick = options.onNodeClick || null;
    this.nodeTextColor = options.nodeTextColor || '#0F172A';
    this.nodeMetaColor = options.nodeMetaColor || '#334155';

    this.topRoot = null;
    this.currentRoot = null;
    this.historyStack = [];
    this.nodeMap = new Map();

    this.breadcrumbId = options.breadcrumbId || null;
    this.backBtnId = options.backBtnId || null;
    this.topBtnId = options.topBtnId || null;
  }

  // Index all nodes in tree for fast lookup by member_id or id
  _indexTree(node) {
    if (!node) return;
    if (node.id) this.nodeMap.set(String(node.id), node);
    if (node.member_id) this.nodeMap.set(String(node.member_id).toUpperCase(), node);
    if (node.left) this._indexTree(node.left);
    if (node.right) this._indexTree(node.right);
  }

  render(rootData) {
    if (!rootData) {
      const svgEl = document.getElementById(this.svgId);
      if (svgEl) svgEl.innerHTML = '<text x="50%" y="50%" text-anchor="middle" fill="#94a3b8" font-family="Inter" font-size="14">No network tree data available</text>';
      return;
    }
    this.topRoot = rootData;
    this.currentRoot = rootData;
    this.historyStack = [rootData];
    this.nodeMap.clear();
    this._indexTree(rootData);
    this.renderCurrent();
  }

  renderCurrent() {
    const svgEl = document.getElementById(this.svgId);
    if (!svgEl) return;
    svgEl.innerHTML = '';

    const root = this.currentRoot || this.topRoot;
    if (!root) return;

    this._updateUIControls();

    // Compute layout for visible nodes (up to maxDepth, plus any manually expanded branches)
    const positions = {};
    let nextLeafX = 50;
    let minX = Infinity;
    let maxX = -Infinity;
    let maxVisibleDepth = 0;

    const computeLayout = (node, depth) => {
      if (!node) return null;
      maxVisibleDepth = Math.max(maxVisibleDepth, depth);

      const hasChildren = !!(node.left || node.right);
      // Start collapsed (depth < 0 means only root).
      // If node is explicitly expanded (_expanded === true), it shows next branch.
      const isExpanded = node._expanded !== undefined ? node._expanded : (depth < this.maxDepth);

      let leftChildId = null;
      let rightChildId = null;

      if (isExpanded) {
        if (node.left) leftChildId = computeLayout(node.left, depth + 1);
        if (node.right) rightChildId = computeLayout(node.right, depth + 1);
      }

      let x;
      const y = depth * this.levelGap + 50;

      if (!leftChildId && !rightChildId) {
        x = nextLeafX;
        nextLeafX += (this.nodeRadius * 2 + 140);
      } else if (leftChildId && rightChildId) {
        x = (positions[leftChildId].x + positions[rightChildId].x) / 2;
      } else if (leftChildId) {
        x = positions[leftChildId].x + 90;
        nextLeafX = Math.max(nextLeafX, x + 100);
      } else {
        x = positions[rightChildId].x - 90;
      }

      const nodeId = `${depth}-${node.id || node.member_id || Math.random()}`;
      positions[nodeId] = {
        x, y, node, depth,
        leftChildId, rightChildId,
        hasChildren,
        isExpanded
      };

      minX = Math.min(minX, x - 100);
      maxX = Math.max(maxX, x + 100);
      return nodeId;
    };

    computeLayout(root, 0);

    // Center the tree in the canvas
    const totalW = Math.max(maxX - minX + 150, 800);
    const totalH = (maxVisibleDepth + 1) * this.levelGap + 120;
    const treeWidth = maxX - minX;
    const offsetX = (totalW - treeWidth) / 2 - minX;

    svgEl.setAttribute('viewBox', `0 0 ${totalW} ${totalH}`);
    svgEl.setAttribute('width', `${totalW}`);
    svgEl.setAttribute('height', `${Math.max(totalH, 520)}`);
    svgEl.style.margin = '0 auto';
    svgEl.style.display = 'block';

    // 1. Draw Orthogonal Connecting Lines (Elbow org-chart lines matching reference image)
    const lineGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    lineGroup.setAttribute('class', 'tree-connectors');

    Object.values(positions).forEach(p => {
      if (p.isExpanded && (p.leftChildId || p.rightChildId)) {
        const parentX = p.x + offsetX;
        const parentY = p.y + this.nodeRadius;
        const childY = (p.y + this.levelGap) - this.nodeRadius;
        const midY = (parentY + childY) / 2;

        // Vertical drop from parent
        const dropLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        dropLine.setAttribute('x1', parentX);
        dropLine.setAttribute('y1', parentY);
        dropLine.setAttribute('x2', parentX);
        dropLine.setAttribute('y2', midY);
        dropLine.setAttribute('stroke', '#94A3B8');
        dropLine.setAttribute('stroke-width', '2.5');
        dropLine.setAttribute('stroke-linecap', 'round');
        lineGroup.appendChild(dropLine);

        let leftX = parentX;
        let rightX = parentX;

        if (p.leftChildId && positions[p.leftChildId]) {
          leftX = positions[p.leftChildId].x + offsetX;
          const leftLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
          leftLine.setAttribute('x1', leftX);
          leftLine.setAttribute('y1', midY);
          leftLine.setAttribute('x2', leftX);
          leftLine.setAttribute('y2', childY);
          leftLine.setAttribute('stroke', '#94A3B8');
          leftLine.setAttribute('stroke-width', '2.5');
          leftLine.setAttribute('stroke-linecap', 'round');
          lineGroup.appendChild(leftLine);
        }

        if (p.rightChildId && positions[p.rightChildId]) {
          rightX = positions[p.rightChildId].x + offsetX;
          const rightLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
          rightLine.setAttribute('x1', rightX);
          rightLine.setAttribute('y1', midY);
          rightLine.setAttribute('x2', rightX);
          rightLine.setAttribute('y2', childY);
          rightLine.setAttribute('stroke', '#94A3B8');
          rightLine.setAttribute('stroke-width', '2.5');
          rightLine.setAttribute('stroke-linecap', 'round');
          lineGroup.appendChild(rightLine);
        }

        // Horizontal crossbar connecting branches
        const hLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        hLine.setAttribute('x1', Math.min(parentX, leftX));
        hLine.setAttribute('y1', midY);
        hLine.setAttribute('x2', Math.max(parentX, rightX));
        hLine.setAttribute('y2', midY);
        hLine.setAttribute('stroke', '#94A3B8');
        hLine.setAttribute('stroke-width', '2.5');
        hLine.setAttribute('stroke-linecap', 'round');
        lineGroup.appendChild(hLine);
      }
    });
    svgEl.appendChild(lineGroup);

    // 2. Draw Nodes (Circular Avatar & Person Silhouette matching reference image)
    const nodeGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    nodeGroup.setAttribute('class', 'tree-nodes');

    Object.values(positions).forEach(p => {
      const node = p.node;
      const nx = p.x + offsetX;
      const ny = p.y;
      const isActive = !!node.is_active;
      const isAdmin = node.role === 'admin';

      // Enhanced color scheme with better visual appeal
      const primaryTeal = '#00BCD4';
      const darkTeal = '#00838F';
      const strokeColor = isAdmin ? '#8B5CF6' : (isActive ? primaryTeal : '#EF4444');
      const circleFill = isAdmin ? '#F3E8FF' : (isActive ? '#E0F2FE' : '#FEE2E2');
      const iconFill = isAdmin ? '#7C3AED' : (isActive ? '#0284C7' : '#DC2626');

      const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      g.setAttribute('transform', `translate(${nx}, ${ny})`);
      g.setAttribute('class', 'tree-node-group');
      g.style.cursor = 'pointer';

      // Circular avatar container
      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('cx', '0');
      circle.setAttribute('cy', '0');
      circle.setAttribute('r', `${this.nodeRadius}`);
      circle.setAttribute('fill', circleFill);
      circle.setAttribute('stroke', strokeColor);
      circle.setAttribute('stroke-width', '3');
      g.appendChild(circle);

      // Person silhouette icon inside avatar circle
      const head = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      head.setAttribute('cx', '0');
      head.setAttribute('cy', '-6');
      head.setAttribute('r', '6');
      head.setAttribute('fill', iconFill);
      g.appendChild(head);

      const body = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      body.setAttribute('d', 'M -11,14 C -11,7 -6,3 0,3 C 6,3 11,7 11,14 Z');
      body.setAttribute('fill', iconFill);
      g.appendChild(body);

      // Member ID text (Line 1: Bold ID)
      const idText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      idText.setAttribute('x', '0');
      idText.setAttribute('y', '42');
      idText.setAttribute('text-anchor', 'middle');
      idText.setAttribute('font-family', 'Inter, system-ui, sans-serif');
      idText.setAttribute('font-size', '12');
      idText.setAttribute('font-weight', '700');
      idText.setAttribute('fill', this.nodeTextColor);
      idText.textContent = node.member_id || `#${node.id}`;
      g.appendChild(idText);

      // Member Name text (Line 2: Title / Name)
      const nameText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      nameText.setAttribute('x', '0');
      nameText.setAttribute('y', '56');
      nameText.setAttribute('text-anchor', 'middle');
      nameText.setAttribute('font-family', 'Inter, system-ui, sans-serif');
      nameText.setAttribute('font-size', '10');
      nameText.setAttribute('font-weight', '500');
      nameText.setAttribute('fill', this.nodeMetaColor);
      const rawName = node.name || 'Member';
      nameText.textContent = rawName.length > 18 ? rawName.substring(0, 16) + '…' : rawName;
      g.appendChild(nameText);

      // Additional downline indicator text (L / R count)
      const subInfo = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      subInfo.setAttribute('x', '0');
      subInfo.setAttribute('y', '72');
      subInfo.setAttribute('text-anchor', 'middle');
      subInfo.setAttribute('font-family', 'Inter, system-ui, sans-serif');
      subInfo.setAttribute('font-size', '9');
      subInfo.setAttribute('font-weight', '600');
      subInfo.setAttribute('fill', strokeColor);
      subInfo.textContent = `L: ${node.left_count || 0} | R: ${node.right_count || 0}`;
      g.appendChild(subInfo);

      // If this node has children that can be extended or collapsed:
      if (p.hasChildren) {
        const pillGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        pillGroup.setAttribute('transform', 'translate(0, 88)');
        pillGroup.style.cursor = 'pointer';

        const pillRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        pillRect.setAttribute('x', '-48');
        pillRect.setAttribute('y', '0');
        pillRect.setAttribute('width', '96');
        pillRect.setAttribute('height', '24');
        pillRect.setAttribute('rx', '12');
        pillRect.setAttribute('fill', p.isExpanded ? '#FFF7ED' : '#F0FDFA');
        pillRect.setAttribute('stroke', p.isExpanded ? '#F97316' : primaryTeal);
        pillRect.setAttribute('stroke-width', '1.5');
        pillGroup.appendChild(pillRect);

        const pillText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        pillText.setAttribute('x', '0');
        pillText.setAttribute('y', '16');
        pillText.setAttribute('text-anchor', 'middle');
        pillText.setAttribute('font-family', 'Inter, system-ui, sans-serif');
        pillText.setAttribute('font-size', '10');
        pillText.setAttribute('font-weight', '700');
        pillText.setAttribute('fill', p.isExpanded ? '#C2410C' : darkTeal);
        pillText.textContent = p.isExpanded ? '▲ Collapse' : '▼ Extend';
        pillGroup.appendChild(pillText);

        pillGroup.addEventListener('click', (e) => {
          e.stopPropagation();
          node._expanded = !p.isExpanded;
          this.renderCurrent();
        });

        g.appendChild(pillGroup);
      }

      // Clicking node circle: drill down or trigger modal details
      circle.addEventListener('click', (e) => {
        e.stopPropagation();
        if (this.onNodeClick) {
          this.onNodeClick(node);
        } else if (p.hasChildren) {
          this.drillDown(node);
        }
      });

      // Double clicking any node drills down into it
      g.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        this.drillDown(node);
      });

      nodeGroup.appendChild(g);
    });

    svgEl.appendChild(nodeGroup);
  }

  drillDown(node) {
    if (!node) return;
    this.historyStack.push(node);
    this.currentRoot = node;
    this.renderCurrent();
  }

  goBack() {
    if (this.historyStack.length > 1) {
      this.historyStack.pop();
      this.currentRoot = this.historyStack[this.historyStack.length - 1];
      this.renderCurrent();
    }
  }

  goTop() {
    if (this.topRoot) {
      this.historyStack = [this.topRoot];
      this.currentRoot = this.topRoot;
      this.renderCurrent();
    }
  }

  searchAndFocus(memberId) {
    if (!memberId) return false;
    const cleanId = String(memberId).trim().toUpperCase();
    const target = this.nodeMap.get(cleanId);
    if (target) {
      this.drillDown(target);
      return true;
    }
    return false;
  }

  _updateUIControls() {
    window.treeNavigateIndex = (idx) => {
      if (this.historyStack[idx]) {
        this.historyStack = this.historyStack.slice(0, idx + 1);
        this.currentRoot = this.historyStack[idx];
        this.renderCurrent();
      }
    };

    // Breadcrumb
    const bcEl = document.getElementById(this.breadcrumbId);
    if (bcEl) {
      if (this.historyStack.length <= 1) {
        bcEl.innerHTML = `<strong>Viewing:</strong> Top Level (${this.currentRoot?.member_id || 'Root'})`;
      } else {
        const items = this.historyStack.map((n, idx) => {
          const isLast = idx === this.historyStack.length - 1;
          const label = n.member_id || n.name || `Node ${idx + 1}`;
          return isLast
            ? `<strong style="color:#00BCD4">${label}</strong>`
            : `<span style="cursor:pointer;text-decoration:underline" onclick="window.treeNavigateIndex(${idx})">${label}</span>`;
        });
        bcEl.innerHTML = `<strong>Downline Path:</strong> ` + items.join(' ❯ ');
      }
    }

    // Back & Top buttons disabled state
    const backBtn = document.getElementById(this.backBtnId);
    if (backBtn) {
      backBtn.disabled = this.historyStack.length <= 1;
      backBtn.style.opacity = this.historyStack.length <= 1 ? '0.5' : '1';
      backBtn.style.cursor = this.historyStack.length <= 1 ? 'not-allowed' : 'pointer';
    }

    const topBtn = document.getElementById(this.topBtnId);
    if (topBtn) {
      topBtn.disabled = this.historyStack.length <= 1;
      topBtn.style.opacity = this.historyStack.length <= 1 ? '0.5' : '1';
      topBtn.style.cursor = this.historyStack.length <= 1 ? 'not-allowed' : 'pointer';
    }
  }
}

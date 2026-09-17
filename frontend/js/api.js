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

// Tree renderer using SVG with modern card design, 3-level default hierarchy, and smooth mobile pinch-to-zoom / pan
class BinaryTreeRenderer {
  constructor(svgId, options = {}) {
    this.svgId = svgId;
    this.maxDepth = options.maxDepth !== undefined ? options.maxDepth : 3; // Show 3 levels by default
    this.cardWidth = options.cardWidth || 184;
    this.cardHeight = options.cardHeight || 108;
    this.levelGap = options.levelGap || 170;
    this.siblingGap = options.siblingGap || 36;
    this.onNodeClick = options.onNodeClick || null;
    this.onZoomChange = options.onZoomChange || null;

    this.topRoot = null;
    this.currentRoot = null;
    this.historyStack = [];
    this.nodeMap = new Map();

    this.breadcrumbId = options.breadcrumbId || null;
    this.backBtnId = options.backBtnId || null;
    this.topBtnId = options.topBtnId || null;

    // Viewport pan & zoom state
    this.scale = 1;
    this.panX = 0;
    this.panY = 0;
    this.minScale = 0.35;
    this.maxScale = 2.5;
    this.isPanning = false;
    this.startPanX = 0;
    this.startPanY = 0;
    this.startTouchDist = 0;
    this.startTouchScale = 1;
    this.pinchCenter = { x: 0, y: 0 };

    this._setupPanZoom();
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
    const svgEl = document.getElementById(this.svgId);
    if (!svgEl) return;

    if (!rootData) {
      svgEl.innerHTML = '<text x="50%" y="50%" text-anchor="middle" fill="#94a3b8" font-family="Inter" font-size="14">No network tree data available</text>';
      return;
    }
    this.topRoot = rootData;
    this.currentRoot = rootData;
    this.historyStack = [rootData];
    this.nodeMap.clear();
    this._indexTree(rootData);

    // Initial scale & pan reset
    this.scale = 1;
    this.panX = 0;
    this.panY = 0;

    this.renderCurrent();
    // Auto fit to view nicely on first load
    setTimeout(() => this.fitToView(), 60);
  }

  renderCurrent() {
    const svgEl = document.getElementById(this.svgId);
    if (!svgEl) return;

    const root = this.currentRoot || this.topRoot;
    if (!root) return;

    this._updateUIControls();

    // Compute layout for visible nodes (Level 1 and 2 open by default, Level 3 visible but collapsed)
    const positions = {};
    let nextLeafX = 0;
    let minX = Infinity;
    let maxX = -Infinity;
    let maxVisibleDepth = 0;

    const computeLayout = (node, depth) => {
      if (!node) return null;
      maxVisibleDepth = Math.max(maxVisibleDepth, depth);

      const hasChildren = !!(node.left || node.right);
      // Default rule: depth 0 (Root/Level 1) & depth 1 (Children/Level 2) are expanded.
      // depth 2 (Grandchildren/Level 3) are rendered with children collapsed by default.
      // If node._expanded is explicitly set by user click, use that!
      const isExpanded = node._expanded !== undefined ? !!node._expanded : (depth < 2);

      let leftChildId = null;
      let rightChildId = null;

      if (isExpanded) {
        if (node.left) leftChildId = computeLayout(node.left, depth + 1);
        if (node.right) rightChildId = computeLayout(node.right, depth + 1);
      }

      let x;
      const y = depth * this.levelGap;

      if (!leftChildId && !rightChildId) {
        x = nextLeafX + this.cardWidth / 2;
        nextLeafX += (this.cardWidth + this.siblingGap);
      } else if (leftChildId && rightChildId) {
        x = (positions[leftChildId].x + positions[rightChildId].x) / 2;
      } else if (leftChildId) {
        x = positions[leftChildId].x + (this.cardWidth + this.siblingGap) / 2;
        nextLeafX = Math.max(nextLeafX, x + this.cardWidth / 2 + this.siblingGap);
      } else {
        x = positions[rightChildId].x - (this.cardWidth + this.siblingGap) / 2;
      }

      const nodeId = `${depth}-${node.id || node.member_id || Math.random()}`;
      positions[nodeId] = {
        x, y, node, depth,
        leftChildId, rightChildId,
        hasChildren,
        isExpanded
      };
      return nodeId;
    };

    const rootId = computeLayout(root, 0);

    // Center all coordinates relative to root at (0, 0)
    const rootX = positions[rootId] ? positions[rootId].x : 0;
    Object.values(positions).forEach(p => {
      p.x = p.x - rootX;
      minX = Math.min(minX, p.x - this.cardWidth / 2);
      maxX = Math.max(maxX, p.x + this.cardWidth / 2);
    });

    const treeWidth = Math.max(maxX - minX, 360);
    const treeHeight = (maxVisibleDepth + 1) * this.levelGap;
    this.contentWidth = treeWidth;
    this.contentHeight = treeHeight;

    const container = svgEl.parentElement;
    const containerW = container ? container.clientWidth : 800;
    const containerH = Math.max(treeHeight + 140, 560);

    svgEl.removeAttribute('viewBox');
    svgEl.style.width = '100%';
    svgEl.style.height = `${containerH}px`;
    svgEl.style.display = 'block';
    svgEl.style.overflow = 'hidden';

    // Build SVG structure: defs + viewport container
    svgEl.innerHTML = `
      <defs>
        <filter id="node-card-shadow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="3" stdDeviation="5" flood-color="#0F172A" flood-opacity="0.07"/>
        </filter>
        <linearGradient id="admin-card-grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#FFFFFF"/>
          <stop offset="100%" stop-color="#FAF5FF"/>
        </linearGradient>
        <linearGradient id="active-card-grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#FFFFFF"/>
          <stop offset="100%" stop-color="#F0FDFA"/>
        </linearGradient>
      </defs>
      <g class="tree-viewport" id="${this.svgId}-viewport" style="transform-origin: 0 0; transition: transform 0.28s cubic-bezier(0.2, 0, 0, 1);">
        <g class="tree-connectors"></g>
        <g class="tree-nodes"></g>
      </g>
    `;

    const viewport = document.getElementById(`${this.svgId}-viewport`);
    if (!viewport) return;
    const lineGroup = viewport.querySelector('.tree-connectors');
    const nodeGroup = viewport.querySelector('.tree-nodes');

    // 1. Draw Clean Orthogonal Connector Lines with Smooth Elbows
    const halfH = this.cardHeight / 2;

    Object.values(positions).forEach(p => {
      if (p.isExpanded && (p.leftChildId || p.rightChildId)) {
        const parentX = p.x;
        // The parent drop line starts below the expand/collapse button
        const parentY = p.y + halfH + 12;
        const childY = (p.y + this.levelGap) - halfH;
        const midY = (parentY + childY) / 2;

        let leftX = parentX;
        let rightX = parentX;

        // Path for parent branch
        const pathParts = [];

        // Vertical drop from parent
        pathParts.push(`M ${parentX} ${parentY} L ${parentX} ${midY}`);

        if (p.leftChildId && positions[p.leftChildId]) {
          leftX = positions[p.leftChildId].x;
          // Smooth rounded elbow from midY to childY
          pathParts.push(`M ${parentX} ${midY} L ${leftX + 8} ${midY} Q ${leftX} ${midY} ${leftX} ${midY + 8} L ${leftX} ${childY}`);
        }

        if (p.rightChildId && positions[p.rightChildId]) {
          rightX = positions[p.rightChildId].x;
          // Smooth rounded elbow from midY to childY
          pathParts.push(`M ${parentX} ${midY} L ${rightX - 8} ${midY} Q ${rightX} ${midY} ${rightX} ${midY + 8} L ${rightX} ${childY}`);
        }

        const pathEl = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        pathEl.setAttribute('d', pathParts.join(' '));
        pathEl.setAttribute('fill', 'none');
        pathEl.setAttribute('stroke', '#94A3B8');
        pathEl.setAttribute('stroke-width', '2.2');
        pathEl.setAttribute('stroke-linecap', 'round');
        pathEl.setAttribute('stroke-linejoin', 'round');
        lineGroup.appendChild(pathEl);
      }
    });

    // 2. Draw Modern Card Pod Nodes
    const cardW = this.cardWidth;
    const cardH = this.cardHeight;
    const halfW = cardW / 2;

    Object.values(positions).forEach(p => {
      const node = p.node;
      const nx = p.x;
      const ny = p.y;
      const isActive = !!node.is_active;
      const isAdmin = node.role === 'admin';

      const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      g.setAttribute('transform', `translate(${nx}, ${ny})`);
      g.setAttribute('class', 'tree-node-group');
      g.style.cursor = 'pointer';
      g.style.transition = 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.25s ease';

      // Card Background Box
      const cardRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      cardRect.setAttribute('x', `${-halfW}`);
      cardRect.setAttribute('y', `${-halfH}`);
      cardRect.setAttribute('width', `${cardW}`);
      cardRect.setAttribute('height', `${cardH}`);
      cardRect.setAttribute('rx', '14');
      cardRect.setAttribute('ry', '14');
      cardRect.setAttribute('fill', isAdmin ? 'url(#admin-card-grad)' : (isActive ? 'url(#active-card-grad)' : '#FFFFFF'));
      cardRect.setAttribute('stroke', isAdmin ? '#8B5CF6' : (isActive ? '#00BCD4' : '#EF4444'));
      cardRect.setAttribute('stroke-width', isAdmin ? '2' : (isActive ? '2' : '1.5'));
      cardRect.setAttribute('filter', 'url(#node-card-shadow)');
      g.appendChild(cardRect);

      // Top Accent Line
      const topAccent = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      topAccent.setAttribute('d', `M ${-halfW + 14} ${-halfH} L ${halfW - 14} ${-halfH}`);
      topAccent.setAttribute('stroke', isAdmin ? '#8B5CF6' : (isActive ? '#00BCD4' : '#EF4444'));
      topAccent.setAttribute('stroke-width', '4');
      topAccent.setAttribute('stroke-linecap', 'round');
      g.appendChild(topAccent);

      // Avatar Circle (Top-Left inside card)
      const avatarG = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      avatarG.setAttribute('transform', `translate(${-halfW + 24}, ${-halfH + 24})`);

      const avatarBg = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      avatarBg.setAttribute('cx', '0');
      avatarBg.setAttribute('cy', '0');
      avatarBg.setAttribute('r', '14');
      avatarBg.setAttribute('fill', isAdmin ? '#EDE9FE' : (isActive ? '#E0F2FE' : '#FEE2E2'));
      avatarBg.setAttribute('stroke', isAdmin ? '#A78BFA' : (isActive ? '#38BDF8' : '#FCA5A5'));
      avatarBg.setAttribute('stroke-width', '1.5');
      avatarG.appendChild(avatarBg);

      // Avatar Person Silhouette
      const aHead = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      aHead.setAttribute('cx', '0');
      aHead.setAttribute('cy', '-3');
      aHead.setAttribute('r', '4');
      aHead.setAttribute('fill', isAdmin ? '#7C3AED' : (isActive ? '#0284C7' : '#DC2626'));
      avatarG.appendChild(aHead);

      const aBody = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      aBody.setAttribute('d', 'M -7,8 C -7,3 -3,1 0,1 C 3,1 7,3 7,8 Z');
      aBody.setAttribute('fill', isAdmin ? '#7C3AED' : (isActive ? '#0284C7' : '#DC2626'));
      avatarG.appendChild(aBody);
      g.appendChild(avatarG);

      // Status Pill (Top-Right inside card)
      const statusPillG = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      statusPillG.setAttribute('transform', `translate(${halfW - 36}, ${-halfH + 24})`);

      const statusRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      statusRect.setAttribute('x', '-26');
      statusRect.setAttribute('y', '-10');
      statusRect.setAttribute('width', '52');
      statusRect.setAttribute('height', '20');
      statusRect.setAttribute('rx', '10');
      statusRect.setAttribute('fill', isAdmin ? '#F3E8FF' : (isActive ? '#DCFCE7' : '#FEE2E2'));
      statusPillG.appendChild(statusRect);

      const statusDot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      statusDot.setAttribute('cx', '-16');
      statusDot.setAttribute('cy', '0');
      statusDot.setAttribute('r', '3');
      statusDot.setAttribute('fill', isAdmin ? '#7C3AED' : (isActive ? '#10B981' : '#EF4444'));
      statusPillG.appendChild(statusDot);

      const statusText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      statusText.setAttribute('x', '3');
      statusText.setAttribute('y', '3.5');
      statusText.setAttribute('text-anchor', 'middle');
      statusText.setAttribute('font-family', 'Inter, system-ui, sans-serif');
      statusText.setAttribute('font-size', '9');
      statusText.setAttribute('font-weight', '700');
      statusText.setAttribute('fill', isAdmin ? '#6D28D9' : (isActive ? '#15803D' : '#B91C1C'));
      statusText.textContent = isAdmin ? 'ADMIN' : (isActive ? 'ACTIVE' : 'INACTIVE');
      statusPillG.appendChild(statusText);
      g.appendChild(statusPillG);

      // Member ID (Bold & High Contrast)
      const idText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      idText.setAttribute('x', '0');
      idText.setAttribute('y', '-4');
      idText.setAttribute('text-anchor', 'middle');
      idText.setAttribute('font-family', 'Inter, system-ui, sans-serif');
      idText.setAttribute('font-size', '13');
      idText.setAttribute('font-weight', '800');
      idText.setAttribute('fill', '#0F172A');
      idText.textContent = node.member_id || `#${node.id}`;
      g.appendChild(idText);

      // Member Name (Clean & Truncated)
      const nameText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      nameText.setAttribute('x', '0');
      nameText.setAttribute('y', '12');
      nameText.setAttribute('text-anchor', 'middle');
      nameText.setAttribute('font-family', 'Inter, system-ui, sans-serif');
      nameText.setAttribute('font-size', '11');
      nameText.setAttribute('font-weight', '500');
      nameText.setAttribute('fill', '#64748B');
      const rawName = node.name || 'Member';
      nameText.textContent = rawName.length > 20 ? rawName.substring(0, 18) + '…' : rawName;
      g.appendChild(nameText);

      // Downline Stats Pill: [ L: X ]  [ R: Y ]
      const statsG = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      statsG.setAttribute('transform', 'translate(0, 31)');

      // Left Count Tag
      const lRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      lRect.setAttribute('x', '-56');
      lRect.setAttribute('y', '-9');
      lRect.setAttribute('width', '52');
      lRect.setAttribute('height', '18');
      lRect.setAttribute('rx', '5');
      lRect.setAttribute('fill', '#F0FDFA');
      lRect.setAttribute('stroke', '#00BCD4');
      lRect.setAttribute('stroke-width', '1');
      statsG.appendChild(lRect);

      const lText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      lText.setAttribute('x', '-30');
      lText.setAttribute('y', '3');
      lText.setAttribute('text-anchor', 'middle');
      lText.setAttribute('font-family', 'Inter, system-ui, sans-serif');
      lText.setAttribute('font-size', '10');
      lText.setAttribute('font-weight', '700');
      lText.setAttribute('fill', '#00838F');
      lText.textContent = `L: ${node.left_count || 0}`;
      statsG.appendChild(lText);

      // Right Count Tag
      const rRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      rRect.setAttribute('x', '4');
      rRect.setAttribute('y', '-9');
      rRect.setAttribute('width', '52');
      rRect.setAttribute('height', '18');
      rRect.setAttribute('rx', '5');
      rRect.setAttribute('fill', '#F5F3FF');
      rRect.setAttribute('stroke', '#8B5CF6');
      rRect.setAttribute('stroke-width', '1');
      statsG.appendChild(rRect);

      const rText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      rText.setAttribute('x', '30');
      rText.setAttribute('y', '3');
      rText.setAttribute('text-anchor', 'middle');
      rText.setAttribute('font-family', 'Inter, system-ui, sans-serif');
      rText.setAttribute('font-size', '10');
      rText.setAttribute('font-weight', '700');
      rText.setAttribute('fill', '#6D28D9');
      rText.textContent = `R: ${node.right_count || 0}`;
      statsG.appendChild(rText);

      g.appendChild(statsG);

      // Expand / Collapse Bottom Toggle Pill
      if (p.hasChildren) {
        const toggleG = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        toggleG.setAttribute('transform', `translate(0, ${halfH})`);
        toggleG.setAttribute('class', 'tree-expand-toggle');
        toggleG.style.cursor = 'pointer';
        toggleG.style.pointerEvents = 'all';

        const totalDownline = (node.left_count || 0) + (node.right_count || 0);
        const toggleW = p.isExpanded ? 84 : 96;
        const toggleH = 22;

        const toggleRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        toggleRect.setAttribute('x', `${-toggleW / 2}`);
        toggleRect.setAttribute('y', `${-toggleH / 2}`);
        toggleRect.setAttribute('width', `${toggleW}`);
        toggleRect.setAttribute('height', `${toggleH}`);
        toggleRect.setAttribute('rx', '11');
        toggleRect.setAttribute('fill', p.isExpanded ? '#FFF7ED' : '#00BCD4');
        toggleRect.setAttribute('stroke', p.isExpanded ? '#F97316' : '#00838F');
        toggleRect.setAttribute('stroke-width', '1.5');
        toggleRect.setAttribute('filter', 'url(#node-card-shadow)');
        toggleG.appendChild(toggleRect);

        const toggleText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        toggleText.setAttribute('x', '0');
        toggleText.setAttribute('y', '3.5');
        toggleText.setAttribute('text-anchor', 'middle');
        toggleText.setAttribute('font-family', 'Inter, system-ui, sans-serif');
        toggleText.setAttribute('font-size', '10');
        toggleText.setAttribute('font-weight', '800');
        toggleText.setAttribute('fill', p.isExpanded ? '#C2410C' : '#FFFFFF');
        toggleText.textContent = p.isExpanded ? '▲ Collapse' : `▼ Extend ${totalDownline > 0 ? `(${totalDownline})` : ''}`;
        toggleG.appendChild(toggleText);

        const onToggleClick = (e) => {
          e.stopPropagation();
          e.preventDefault();
          
          // Add expanding/collapsing class to prevent animations during toggle
          const svgElement = this.svg;
          svgElement.classList.add('tree-animating');
          
          node._expanded = !p.isExpanded;
          this.renderCurrent();
          
          // Remove animating class after render
          setTimeout(() => {
            svgElement.classList.remove('tree-animating');
          }, 50);
        };

        toggleG.addEventListener('click', onToggleClick);
        toggleG.addEventListener('touchend', onToggleClick);
        g.appendChild(toggleG);
      }

      // Card click: drill down or trigger modal details
      cardRect.addEventListener('click', (e) => {
        e.stopPropagation();
        if (this.onNodeClick) {
          this.onNodeClick(node);
        } else if (p.hasChildren) {
          this.drillDown(node);
        }
      });

      g.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        this.drillDown(node);
      });

      nodeGroup.appendChild(g);
    });

    // Apply current pan & zoom transform to viewport
    this.applyTransform(false);
  }


  // Viewport Pan & Zoom engine (Supports Pinch-to-zoom on Mobile & Drag/Wheel on Desktop)
  _setupPanZoom() {
    const getSvg = () => document.getElementById(this.svgId);

    const onPointerDown = (e) => {
      const svg = getSvg();
      if (!svg || (e.target && e.target.closest && e.target.closest('.tree-expand-toggle'))) return;
      this.isPanning = true;
      this.startPanX = e.clientX - this.panX;
      this.startPanY = e.clientY - this.panY;
      svg.style.cursor = 'grabbing';
    };

    const onPointerMove = (e) => {
      if (!this.isPanning) return;
      e.preventDefault();
      this.panX = e.clientX - this.startPanX;
      this.panY = e.clientY - this.startPanY;
      this.applyTransform(false);
    };

    const onPointerUp = () => {
      this.isPanning = false;
      const svg = getSvg();
      if (svg) svg.style.cursor = 'grab';
    };

    // Touch events for Mobile Preview (Single-finger drag + Two-finger pinch zoom)
    const onTouchStart = (e) => {
      const svg = getSvg();
      if (!svg) return;
      if (e.target && e.target.closest && e.target.closest('.tree-expand-toggle')) return;

      if (e.touches.length === 1) {
        // Single finger pan
        this.isPanning = true;
        this.startPanX = e.touches[0].clientX - this.panX;
        this.startPanY = e.touches[0].clientY - this.panY;
      } else if (e.touches.length === 2) {
        // Two-finger pinch zoom
        this.isPanning = false;
        const t1 = e.touches[0];
        const t2 = e.touches[1];
        this.startTouchDist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
        this.startTouchScale = this.scale;
        const rect = svg.getBoundingClientRect();
        this.pinchCenter = {
          x: (t1.clientX + t2.clientX) / 2 - rect.left,
          y: (t1.clientY + t2.clientY) / 2 - rect.top
        };
      }
    };

    const onTouchMove = (e) => {
      if (e.touches.length === 1 && this.isPanning) {
        e.preventDefault();
        this.panX = e.touches[0].clientX - this.startPanX;
        this.panY = e.touches[0].clientY - this.startPanY;
        this.applyTransform(false);
      } else if (e.touches.length === 2) {
        e.preventDefault();
        const t1 = e.touches[0];
        const t2 = e.touches[1];
        const dist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
        if (this.startTouchDist > 0) {
          const factor = dist / this.startTouchDist;
          const newScale = Math.max(this.minScale, Math.min(this.maxScale, this.startTouchScale * factor));
          this.scale = newScale;
          this.applyTransform(false);
          if (this.onZoomChange) this.onZoomChange(this.scale);
        }
      }
    };

    const onTouchEnd = (e) => {
      if (e.touches.length === 0) {
        this.isPanning = false;
        this.startTouchDist = 0;
      } else if (e.touches.length === 1) {
        this.isPanning = true;
        this.startPanX = e.touches[0].clientX - this.panX;
        this.startPanY = e.touches[0].clientY - this.panY;
      }
    };

    // Wheel zoom on desktop
    const onWheel = (e) => {
      const svg = getSvg();
      if (!svg) return;
      e.preventDefault();
      const zoomFactor = e.deltaY < 0 ? 1.12 : 0.88;
      const newScale = Math.max(this.minScale, Math.min(this.maxScale, this.scale * zoomFactor));
      this.scale = newScale;
      this.applyTransform(false);
      if (this.onZoomChange) this.onZoomChange(this.scale);
    };

    const attach = () => {
      const svg = getSvg();
      if (!svg || svg._panZoomAttached) return;
      svg._panZoomAttached = true;
      svg.style.cursor = 'grab';
      svg.style.touchAction = 'none';

      svg.addEventListener('mousedown', onPointerDown);
      window.addEventListener('mousemove', onPointerMove);
      window.addEventListener('mouseup', onPointerUp);

      svg.addEventListener('touchstart', onTouchStart, { passive: false });
      svg.addEventListener('touchmove', onTouchMove, { passive: false });
      svg.addEventListener('touchend', onTouchEnd);

      svg.addEventListener('wheel', onWheel, { passive: false });
    };

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', attach);
    } else {
      setTimeout(attach, 0);
    }
  }

  applyTransform(animate = false) {
    const viewport = document.getElementById(`${this.svgId}-viewport`);
    if (!viewport) return;
    if (animate) {
      viewport.style.transition = 'transform 0.28s cubic-bezier(0.2, 0, 0, 1)';
    } else {
      viewport.style.transition = 'none';
    }
    const svg = document.getElementById(this.svgId);
    const containerW = svg ? (svg.parentElement?.clientWidth || svg.clientWidth || 800) : 800;
    const centerX = containerW / 2;
    const startY = 70;
    viewport.style.transform = `translate(${centerX + this.panX}px, ${startY + this.panY}px) scale(${this.scale})`;
  }

  zoomIn(step = 0.2) {
    this.scale = Math.min(this.maxScale, this.scale + step);
    this.applyTransform(true);
    if (this.onZoomChange) this.onZoomChange(this.scale);
  }

  zoomOut(step = 0.2) {
    this.scale = Math.max(this.minScale, this.scale - step);
    this.applyTransform(true);
    if (this.onZoomChange) this.onZoomChange(this.scale);
  }

  resetZoom() {
    this.scale = 1;
    this.panX = 0;
    this.panY = 0;
    this.applyTransform(true);
    if (this.onZoomChange) this.onZoomChange(this.scale);
  }

  fitToView() {
    const svg = document.getElementById(this.svgId);
    if (!svg || !this.contentWidth) return;
    const container = svg.parentElement;
    const containerW = container ? container.clientWidth : 800;

    // Calculate ideal scale so all visible nodes comfortably fit horizontally
    const idealScale = Math.min(1.0, Math.max(0.42, (containerW - 30) / (this.contentWidth + 40)));
    this.scale = idealScale;
    this.panX = 0;
    this.panY = 0;
    this.applyTransform(true);
    if (this.onZoomChange) this.onZoomChange(this.scale);
  }


  drillDown(node) {
    if (!node) return;
    this.historyStack.push(node);
    this.currentRoot = node;
    this.renderCurrent();
    setTimeout(() => this.fitToView(), 50);
  }

  goBack() {
    if (this.historyStack.length > 1) {
      this.historyStack.pop();
      this.currentRoot = this.historyStack[this.historyStack.length - 1];
      this.renderCurrent();
      setTimeout(() => this.fitToView(), 50);
    }
  }

  goTop() {
    if (this.topRoot) {
      this.historyStack = [this.topRoot];
      this.currentRoot = this.topRoot;
      this.renderCurrent();
      setTimeout(() => this.fitToView(), 50);
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
        setTimeout(() => this.fitToView(), 50);
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


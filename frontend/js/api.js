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
  const contentType = res.headers.get('content-type') || '';
  let data;
  if (contentType.includes('application/json')) {
    data = await res.json();
  } else {
    const text = await res.text();
    if (res.status === 401) {
      logout();
      throw new Error('Session expired. Please log in again.');
    }
    if (!res.ok) {
      throw new Error(`Server error (${res.status}): Endpoint ${endpoint} is unavailable.`);
    }
    throw new Error(`Invalid response format from server for ${endpoint}`);
  }
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
  const num = parseFloat(amount || 0);
  const formatted = Math.abs(num).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  return num < 0 ? `-₹${formatted}` : `₹${formatted}`;
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

// Tree renderer using SVG with sticky symmetrical layout, 3-level default hierarchy, smooth extend/retract and butter-smooth zoom
class BinaryTreeRenderer {
  constructor(svgId, options = {}) {
    this.svgId = svgId;
    this.maxDepth = options.maxDepth !== undefined ? options.maxDepth : 3; // Show 3 levels by default
    this.cardWidth = options.cardWidth || 184;
    this.cardHeight = options.cardHeight || 112;
    this.levelGap = options.levelGap || 165;
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
    this.minScale = 0.32;
    this.maxScale = 2.5;
    this.isPanning = false;
    this.startPanX = 0;
    this.startPanY = 0;
    this.startTouchDist = 0;
    this.startTouchScale = 1;

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

  // Clear expanded flags to reset to default 3 levels (depth 0 & 1 open, depth 2 collapsed)
  _resetExpanded(node) {
    if (!node) return;
    delete node._expanded;
    delete node._isToggling;
    if (node.left) this._resetExpanded(node.left);
    if (node.right) this._resetExpanded(node.right);
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
    this._resetExpanded(rootData);

    // Initial scale & pan reset
    this.scale = 1;
    this.panX = 0;
    this.panY = 0;

    // Clean viewport on initial render
    svgEl.innerHTML = '';
    this.renderCurrent();
    // Auto fit to view nicely on first load
    setTimeout(() => this.fitToView(), 60);
  }

  // Compute fixed, deterministic binary layout where node positions NEVER shift when branches open/close
  _computeStickyLayout(root) {
    const positions = {};
    let minX = 0;
    let maxX = 0;
    let maxVisibleDepth = 0;

    // Fixed horizontal separation offsets by depth level
    const getDelta = (depth) => {
      if (depth === 0) return 480;
      if (depth === 1) return 240;
      if (depth === 2) return 120;
      return 60;
    };

    const traverse = (node, depth, x, parentX, parentY, parentNodeId) => {
      if (!node) return null;
      maxVisibleDepth = Math.max(maxVisibleDepth, depth);

      const hasChildren = !!(node.left || node.right);
      // Default rule: depth 0 (Root/Level 1) & depth 1 (Children/Level 2) are expanded.
      // depth 2 (Grandchildren/Level 3) are rendered with children collapsed by default.
      // When explicitly toggled by user, use node._expanded!
      const isExpanded = node._expanded !== undefined ? !!node._expanded : (depth < 2);
      const y = depth * this.levelGap;

      minX = Math.min(minX, x - this.cardWidth / 2);
      maxX = Math.max(maxX, x + this.cardWidth / 2);

      const nodeId = `node-${node.id || node.member_id || Math.random()}`;

      let leftChildId = null;
      let rightChildId = null;

      if (isExpanded) {
        const delta = getDelta(depth);
        if (node.left) {
          leftChildId = traverse(node.left, depth + 1, x - delta, x, y, nodeId);
        }
        if (node.right) {
          rightChildId = traverse(node.right, depth + 1, x + delta, x, y, nodeId);
        }
      }

      positions[nodeId] = {
        nodeId,
        x,
        y,
        parentX: parentX !== undefined ? parentX : x,
        parentY: parentY !== undefined ? parentY : y,
        parentNodeId,
        node,
        depth,
        leftChildId,
        rightChildId,
        hasChildren,
        isExpanded
      };

      return nodeId;
    };

    const rootId = traverse(root, 0, 0, 0, 0, null);
    return { positions, rootId, minX, maxX, maxVisibleDepth };
  }

  renderCurrent(animatingFromNodeId = null, action = null) {
    const svgEl = document.getElementById(this.svgId);
    if (!svgEl) return;

    const root = this.currentRoot || this.topRoot;
    if (!root) return;

    this._updateUIControls();

    const { positions, minX, maxX } = this._computeStickyLayout(root);
    this.contentWidth = Math.max(maxX - minX, 1200);

    svgEl.removeAttribute('viewBox');
    svgEl.style.width = '100%';
    svgEl.style.height = '100%';
    svgEl.style.display = 'block';
    svgEl.style.overflow = 'hidden';

    // 1. Ensure defs and viewport structure exist
    let viewport = document.getElementById(`${this.svgId}-viewport`);
    if (!viewport) {
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
        <g class="tree-viewport" id="${this.svgId}-viewport" style="transform-origin: 0 0;">
          <g class="tree-connectors"></g>
          <g class="tree-nodes"></g>
        </g>
      `;
      viewport = document.getElementById(`${this.svgId}-viewport`);
    }

    if (!viewport) return;
    const lineGroup = viewport.querySelector('.tree-connectors');
    const nodeGroup = viewport.querySelector('.tree-nodes');

    // 2. Render or Update Orthogonal Connector Lines
    const halfH = this.cardHeight / 2;
    const activeConnectorIds = new Set();

    Object.values(positions).forEach(p => {
      if (p.isExpanded && (p.leftChildId || p.rightChildId)) {
        const connectorId = `conn-${p.nodeId}`;
        activeConnectorIds.add(connectorId);

        const parentX = p.x;
        const parentY = p.y + halfH + 11;
        const childY = (p.y + this.levelGap) - halfH;
        const midY = (parentY + childY) / 2;

        const pathParts = [];
        pathParts.push(`M ${parentX} ${parentY} L ${parentX} ${midY}`);

        if (p.leftChildId && positions[p.leftChildId]) {
          const leftX = positions[p.leftChildId].x;
          pathParts.push(`M ${parentX} ${midY} L ${leftX + 8} ${midY} Q ${leftX} ${midY} ${leftX} ${midY + 8} L ${leftX} ${childY}`);
        }

        if (p.rightChildId && positions[p.rightChildId]) {
          const rightX = positions[p.rightChildId].x;
          pathParts.push(`M ${parentX} ${midY} L ${rightX - 8} ${midY} Q ${rightX} ${midY} ${rightX} ${midY + 8} L ${rightX} ${childY}`);
        }

        let pathEl = lineGroup.querySelector(`[data-connector-id="${connectorId}"]`);

        if (!pathEl) {
          pathEl = document.createElementNS('http://www.w3.org/2000/svg', 'path');
          pathEl.setAttribute('data-connector-id', connectorId);
          pathEl.setAttribute('data-connector-from', p.nodeId);
          pathEl.setAttribute('class', 'tree-connector-path');
          pathEl.setAttribute('fill', 'none');
          pathEl.setAttribute('stroke', '#94A3B8');
          pathEl.setAttribute('stroke-width', '2.2');
          pathEl.setAttribute('stroke-linecap', 'round');
          pathEl.setAttribute('stroke-linejoin', 'round');
          pathEl.style.transition = 'opacity 0.28s ease';

          if (animatingFromNodeId && action === 'extend') {
            pathEl.style.opacity = '0';
          }
          lineGroup.appendChild(pathEl);

          if (animatingFromNodeId && action === 'extend') {
            requestAnimationFrame(() => {
              requestAnimationFrame(() => {
                pathEl.style.opacity = '1';
              });
            });
          }
        }

        pathEl.setAttribute('d', pathParts.join(' '));
      }
    });

    // Remove obsolete connectors
    lineGroup.querySelectorAll('.tree-connector-path').forEach(conn => {
      const id = conn.getAttribute('data-connector-id');
      if (!activeConnectorIds.has(id)) {
        conn.remove();
      }
    });

    // 3. Render or Update Node Cards
    const activeNodeIds = new Set();
    const newNodesToAnimate = [];

    Object.values(positions).forEach(p => {
      activeNodeIds.add(p.nodeId);
      let g = nodeGroup.querySelector(`[data-node-id="${p.nodeId}"]`);

      if (!g) {
        // Create new node element
        const isNewChild = (animatingFromNodeId && action === 'extend');
        g = this._createCardNode(p, isNewChild);
        nodeGroup.appendChild(g);

        if (isNewChild) {
          newNodesToAnimate.push({ el: g, targetX: p.x, targetY: p.y });
        }
      } else {
        // Update existing node (toggle text, state)
        this._updateCardNode(g, p);
        // Firmly anchor stationary position without animation jump
        g.setAttribute('transform', `translate(${p.x}, ${p.y})`);
        g.style.opacity = '1';
      }
    });

    // Trigger smooth extend animation on newly added child nodes
    if (newNodesToAnimate.length > 0) {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          newNodesToAnimate.forEach(item => {
            item.el.setAttribute('transform', `translate(${item.targetX}, ${item.targetY})`);
            item.el.style.opacity = '1';
          });
        });
      });
    }

    // Remove any nodes no longer in active layout
    nodeGroup.querySelectorAll('.tree-node-group').forEach(el => {
      const id = el.getAttribute('data-node-id');
      if (!activeNodeIds.has(id)) {
        el.remove();
      }
    });

    // Apply viewport transform (keep pan & zoom sticky)
    this.applyTransform(false);
  }

  // Smoothly extend a collapsed node
  extendNode(p) {
    if (p.node._isToggling) return;
    p.node._isToggling = true;
    p.node._expanded = true;

    this.renderCurrent(p.nodeId, 'extend');

    setTimeout(() => {
      p.node._isToggling = false;
    }, 350);
  }

  // Smoothly contract (retract) an expanded node back into parent
  retractNode(p) {
    const viewport = document.getElementById(`${this.svgId}-viewport`);
    if (!viewport || p.node._isToggling) return;
    const nodeGroup = viewport.querySelector('.tree-nodes');
    const lineGroup = viewport.querySelector('.tree-connectors');
    if (!nodeGroup || !lineGroup) return;

    p.node._isToggling = true;

    // Collect all descendant node IDs of p
    const descendantIds = new Set();
    const collectDescendants = (node) => {
      if (!node) return;
      if (node.left) {
        descendantIds.add(`node-${node.left.id || node.left.member_id}`);
        collectDescendants(node.left);
      }
      if (node.right) {
        descendantIds.add(`node-${node.right.id || node.right.member_id}`);
        collectDescendants(node.right);
      }
    };
    collectDescendants(p.node);

    // Smoothly slide descendant nodes up 16px and fade out
    descendantIds.forEach(id => {
      const el = nodeGroup.querySelector(`[data-node-id="${id}"]`);
      if (el) {
        el.style.transition = 'transform 0.22s ease-in, opacity 0.2s ease-in';
        const curTransform = el.getAttribute('transform') || '';
        const match = curTransform.match(/translate\(([^,]+),\s*([^)]+)\)/);
        if (match) {
          const curX = parseFloat(match[1]);
          const curY = parseFloat(match[2]);
          el.setAttribute('transform', `translate(${curX}, ${curY - 16})`);
        }
        el.style.opacity = '0';
      }
      const conn = lineGroup.querySelector(`[data-connector-from="${id}"]`);
      if (conn) {
        conn.style.transition = 'opacity 0.2s ease';
        conn.style.opacity = '0';
      }
    });

    // Fade out connector originating from p
    const pConn = lineGroup.querySelector(`[data-connector-from="${p.nodeId}"]`);
    if (pConn) {
      pConn.style.transition = 'opacity 0.2s ease';
      pConn.style.opacity = '0';
    }

    // Instantly update parent's toggle button to show "Extend"
    const pGroup = nodeGroup.querySelector(`[data-node-id="${p.nodeId}"]`);
    if (pGroup) {
      const toggleG = pGroup.querySelector('.tree-expand-toggle');
      if (toggleG) {
        const totalDownline = (p.node.left_count || 0) + (p.node.right_count || 0);
        const rect = toggleG.querySelector('rect');
        const text = toggleG.querySelector('text');
        if (rect) {
          rect.setAttribute('fill', '#00BCD4');
          rect.setAttribute('stroke', '#00838F');
        }
        if (text) {
          text.setAttribute('fill', '#FFFFFF');
          text.textContent = `▼ Extend ${totalDownline > 0 ? `(${totalDownline})` : ''}`;
        }
      }
    }

    setTimeout(() => {
      p.node._expanded = false;
      p.node._isToggling = false;

      // Remove descendant elements
      descendantIds.forEach(id => {
        const el = nodeGroup.querySelector(`[data-node-id="${id}"]`);
        if (el) el.remove();
        const conn = lineGroup.querySelector(`[data-connector-from="${id}"]`);
        if (conn) conn.remove();
      });
      if (pConn) pConn.remove();

      this.renderCurrent();
    }, 240);
  }

  // Create an SVG Node Card
  _createCardNode(p, isNewChild = false) {
    const node = p.node;
    const nx = p.x;
    const ny = p.y;
    const isActive = !!node.is_active;
    const isAdmin = node.role === 'admin';
    const cardW = this.cardWidth;
    const cardH = this.cardHeight;
    const halfW = cardW / 2;
    const halfH = cardH / 2;

    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('class', 'tree-node-group');
    g.setAttribute('data-node-id', p.nodeId);
    g.setAttribute('data-parent-id', p.parentNodeId || '');
    g.setAttribute('transform', isNewChild ? `translate(${nx}, ${ny - 16})` : `translate(${nx}, ${ny})`);
    g.style.cursor = 'pointer';
    g.style.opacity = isNewChild ? '0' : '1';
    g.style.transition = 'transform 0.28s ease-out, opacity 0.25s ease-out';

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

    // Expand / Retract Bottom Toggle Pill
    if (p.hasChildren) {
      const toggleG = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      toggleG.setAttribute('transform', `translate(0, 56)`);
      toggleG.setAttribute('class', 'tree-expand-toggle');
      toggleG.style.cursor = 'pointer';
      toggleG.style.pointerEvents = 'all';

      const totalDownline = (node.left_count || 0) + (node.right_count || 0);

      // Constant, fixed pill size so it NEVER jumps on click/toggle
      const toggleRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      toggleRect.setAttribute('x', '-48');
      toggleRect.setAttribute('y', '-11');
      toggleRect.setAttribute('width', '96');
      toggleRect.setAttribute('height', '22');
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
      toggleText.textContent = p.isExpanded ? '▲ Retract' : `▼ Extend ${totalDownline > 0 ? `(${totalDownline})` : ''}`;
      toggleG.appendChild(toggleText);

      const onToggleClick = (e) => {
        e.stopPropagation();
        e.preventDefault();
        if (node._isToggling) return;
        const currentlyExpanded = node._expanded !== undefined ? !!node._expanded : (p.depth < 2);
        if (currentlyExpanded) {
          this.retractNode(p);
        } else {
          this.extendNode(p);
        }
      };

      toggleG.addEventListener('click', onToggleClick);
      toggleG.addEventListener('touchend', onToggleClick);
      g.appendChild(toggleG);
    }

    // Card click: drill down or trigger modal details
    g.addEventListener('click', (e) => {
      if (e.target && e.target.closest && e.target.closest('.tree-expand-toggle')) return;
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

    return g;
  }

  // Update existing card DOM element (toggle text, state) without resizing or jumping
  _updateCardNode(g, p) {
    if (!g) return;
    const node = p.node;
    const totalDownline = (node.left_count || 0) + (node.right_count || 0);

    const toggleG = g.querySelector('.tree-expand-toggle');
    if (toggleG) {
      const rect = toggleG.querySelector('rect');
      const text = toggleG.querySelector('text');

      if (rect) {
        rect.setAttribute('x', '-48');
        rect.setAttribute('width', '96');
        rect.setAttribute('fill', p.isExpanded ? '#FFF7ED' : '#00BCD4');
        rect.setAttribute('stroke', p.isExpanded ? '#F97316' : '#00838F');
      }
      if (text) {
        text.setAttribute('fill', p.isExpanded ? '#C2410C' : '#FFFFFF');
        text.textContent = p.isExpanded ? '▲ Retract' : `▼ Extend ${totalDownline > 0 ? `(${totalDownline})` : ''}`;
      }
    }
  }

  // Viewport Pan & Zoom engine (Threshold-guarded drag so clicks NEVER move the tree)
  _setupPanZoom() {
    const getSvg = () => document.getElementById(this.svgId);
    let isPotentialPan = false;
    let dragStartX = 0;
    let dragStartY = 0;
    const DRAG_THRESHOLD = 5;

    const onPointerDown = (e) => {
      const svg = getSvg();
      if (!svg) return;
      // Do not initiate pan on cards or buttons
      if (e.target && e.target.closest && (e.target.closest('.tree-expand-toggle') || e.target.closest('.tree-node-group'))) return;

      isPotentialPan = true;
      dragStartX = e.clientX;
      dragStartY = e.clientY;
      this.startPanX = e.clientX - this.panX;
      this.startPanY = e.clientY - this.panY;
    };

    const onPointerMove = (e) => {
      if (isPotentialPan && !this.isPanning) {
        if (Math.hypot(e.clientX - dragStartX, e.clientY - dragStartY) > DRAG_THRESHOLD) {
          this.isPanning = true;
          const svg = getSvg();
          if (svg) svg.style.cursor = 'grabbing';
        }
      }
      if (!this.isPanning) return;
      e.preventDefault();
      this.panX = e.clientX - this.startPanX;
      this.panY = e.clientY - this.startPanY;
      this.applyTransform(false);
    };

    const onPointerUp = () => {
      isPotentialPan = false;
      this.isPanning = false;
      const svg = getSvg();
      if (svg) svg.style.cursor = 'grab';
    };

    // Touch events for Mobile with drag threshold
    let touchStartX = 0;
    let touchStartY = 0;
    let isPotentialTouchPan = false;

    const onTouchStart = (e) => {
      const svg = getSvg();
      if (!svg) return;
      if (e.target && e.target.closest && (e.target.closest('.tree-expand-toggle') || e.target.closest('.tree-node-group'))) return;

      if (e.touches.length === 1) {
        isPotentialTouchPan = true;
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
        this.startPanX = e.touches[0].clientX - this.panX;
        this.startPanY = e.touches[0].clientY - this.panY;
      } else if (e.touches.length === 2) {
        isPotentialTouchPan = false;
        this.isPanning = false;
        const t1 = e.touches[0];
        const t2 = e.touches[1];
        this.startTouchDist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
        this.startTouchScale = this.scale;
      }
    };

    const onTouchMove = (e) => {
      if (e.touches.length === 1 && isPotentialTouchPan) {
        if (!this.isPanning && Math.hypot(e.touches[0].clientX - touchStartX, e.touches[0].clientY - touchStartY) > DRAG_THRESHOLD) {
          this.isPanning = true;
        }
        if (this.isPanning) {
          e.preventDefault();
          this.panX = e.touches[0].clientX - this.startPanX;
          this.panY = e.touches[0].clientY - this.startPanY;
          this.applyTransform(false);
        }
      } else if (e.touches.length === 2) {
        e.preventDefault();
        const t1 = e.touches[0];
        const t2 = e.touches[1];
        const dist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
        if (this.startTouchDist > 0) {
          const factor = dist / this.startTouchDist;
          const newScale = Math.max(this.minScale, Math.min(this.maxScale, +(this.startTouchScale * factor).toFixed(3)));
          this.scale = newScale;
          this.applyTransform(false);
          if (this.onZoomChange) this.onZoomChange(this.scale);
        }
      }
    };

    const onTouchEnd = (e) => {
      if (e.touches.length === 0) {
        isPotentialTouchPan = false;
        this.isPanning = false;
        this.startTouchDist = 0;
      } else if (e.touches.length === 1) {
        isPotentialTouchPan = true;
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
        this.startPanX = e.touches[0].clientX - this.panX;
        this.startPanY = e.touches[0].clientY - this.panY;
      }
    };

    // Smooth Wheel zoom on desktop (centered on mouse cursor)
    const onWheel = (e) => {
      const svg = getSvg();
      if (!svg) return;
      e.preventDefault();

      const rect = svg.getBoundingClientRect();
      const containerW = svg.parentElement?.clientWidth || svg.clientWidth || 800;
      const centerX = Math.round(containerW / 2);
      const startY = 80;

      // Position relative to viewport origin
      const mouseX = e.clientX - rect.left - centerX - this.panX;
      const mouseY = e.clientY - rect.top - startY - this.panY;

      // Smooth geometric scaling step
      const zoomFactor = e.deltaY < 0 ? 1.09 : 0.91;
      const newScale = Math.max(this.minScale, Math.min(this.maxScale, +(this.scale * zoomFactor).toFixed(3)));

      if (Math.abs(newScale - this.scale) > 0.001) {
        const ratio = newScale / this.scale;
        this.panX -= mouseX * (ratio - 1);
        this.panY -= mouseY * (ratio - 1);
        this.scale = newScale;

        this.applyTransform(true, '0.12s');
        if (this.onZoomChange) this.onZoomChange(this.scale);
      }
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

  applyTransform(animate = false, duration = '0.35s') {
    const viewport = document.getElementById(`${this.svgId}-viewport`);
    if (!viewport) return;
    if (animate) {
      viewport.style.transition = `transform ${duration} cubic-bezier(0.25, 1, 0.5, 1)`;
    } else {
      viewport.style.transition = 'none';
    }
    const svg = document.getElementById(this.svgId);
    const containerW = svg ? (svg.parentElement?.clientWidth || svg.clientWidth || 800) : 800;
    const centerX = containerW / 2;
    const startY = 80;
    viewport.style.transform = `translate(${centerX + this.panX}px, ${startY + this.panY}px) scale(${this.scale})`;
  }

  zoomIn(step = 0.18) {
    this.scale = Math.min(this.maxScale, +(this.scale + step).toFixed(2));
    this.applyTransform(true, '0.35s');
    if (this.onZoomChange) this.onZoomChange(this.scale);
  }

  zoomOut(step = 0.18) {
    this.scale = Math.max(this.minScale, +(this.scale - step).toFixed(2));
    this.applyTransform(true, '0.35s');
    if (this.onZoomChange) this.onZoomChange(this.scale);
  }

  resetZoom() {
    this.scale = 1;
    this.panX = 0;
    this.panY = 0;
    this.applyTransform(true, '0.42s');
    if (this.onZoomChange) this.onZoomChange(this.scale);
  }

  fitToView() {
    const svg = document.getElementById(this.svgId);
    if (!svg) return;
    const container = svg.parentElement;
    const containerW = container ? container.clientWidth : 800;
    const contentW = this.contentWidth || 1600;

    // Calculate ideal scale so all visible nodes comfortably fit horizontally
    const idealScale = Math.min(1.0, Math.max(0.38, (containerW - 40) / (contentW + 60)));
    this.scale = +(idealScale.toFixed(2));
    this.panX = 0;
    this.panY = 0;
    this.applyTransform(true, '0.45s');
    if (this.onZoomChange) this.onZoomChange(this.scale);
  }

  drillDown(node) {
    if (!node) return;
    this.historyStack.push(node);
    this.currentRoot = node;
    this._resetExpanded(node);
    const svgEl = document.getElementById(this.svgId);
    if (svgEl) svgEl.innerHTML = '';
    this.renderCurrent();
    setTimeout(() => this.fitToView(), 50);
  }

  goBack() {
    if (this.historyStack.length > 1) {
      this.historyStack.pop();
      this.currentRoot = this.historyStack[this.historyStack.length - 1];
      const svgEl = document.getElementById(this.svgId);
      if (svgEl) svgEl.innerHTML = '';
      this.renderCurrent();
      setTimeout(() => this.fitToView(), 50);
    }
  }

  goTop() {
    if (this.topRoot) {
      this._resetExpanded(this.topRoot);
      this.historyStack = [this.topRoot];
      this.currentRoot = this.topRoot;
      const svgEl = document.getElementById(this.svgId);
      if (svgEl) svgEl.innerHTML = '';
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
        const svgEl = document.getElementById(this.svgId);
        if (svgEl) svgEl.innerHTML = '';
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

if (typeof window !== 'undefined') {
  window.BinaryTreeRenderer = BinaryTreeRenderer;
}
